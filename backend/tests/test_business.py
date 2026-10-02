import asyncio
import json
from datetime import date

import pytest
from helpers import login
from pydantic import ValidationError

from workbench.agent import emit, execute_tool, permission, target_path, verify
from workbench.db import (
    Audit,
    Event,
    Plan,
    Repository,
    Run,
    Scan,
    Token,
    all_items,
    get,
    save,
)
from workbench.planning import Capacity, Task, schedule
from workbench.security import (
    builtin,
    dependencies,
    finding_evidence,
    review_findings,
    triage,
)
from workbench.services import fernet


def task(identity="T1", **updates):
    return Task(id=identity, title="fix", h=2, **updates)


def test_capacity_dependencies_and_reproducibility():
    tasks = [task(), task("T2", dep="T1", who="human")]
    cap = Capacity(hours=1, start="2026-10-08", blocked=[date(2026, 10, 9)])
    result = schedule(tasks, cap)
    assert result == schedule(tasks, cap)
    first = next(t for t in result if t["id"] == "T1")
    assert all(t["date"] > first["date"] for t in result if t["id"] == "T2")
    assert all(t["date"] != "2026-10-09" for t in result)
    assert sum(t["hours"] for t in result if t["id"] == "T2") == 2
    assert all(t["hours"] <= 1 for t in result if t["who"] == "human")


def test_task_pinned_to_a_rest_day_stays_there():
    # 2026-10-03 is a Saturday; the default capacity works Monday to Friday.
    cap = Capacity(start="2026-10-01")
    pinned = task("T5", on=date(2026, 10, 3))
    result = schedule([pinned, task("T1")], cap)
    assert [t["date"] for t in result if t["id"] == "T5"] == ["2026-10-03"]
    # Unpinned tasks never use the rest day, and a not_before alone still skips it.
    assert all(t["date"] != "2026-10-03" for t in result if t["id"] == "T1")
    later = schedule([task("T9", not_before=date(2026, 10, 3))], cap)
    assert later[0]["date"] == "2026-10-05"


def test_pinned_task_respects_dependencies_and_overflows_forward():
    cap = Capacity(start="2026-10-01")
    long = task("T2", dep="T1", on=date(2026, 10, 3))
    long.h = 6
    result = schedule([task("T1"), long], cap)
    days = [t["date"] for t in result if t["id"] == "T2"]
    # T1 ends on Thursday 10-01, so the pin on Saturday holds; the extra hours
    # that do not fit in one agent day move to the next working day.
    assert days == ["2026-10-03", "2026-10-05"]
    early = task("T3", dep="T1", on=date(2026, 9, 28))
    first = schedule([task("T1"), early], cap)
    assert next(t for t in first if t["id"] == "T3")["date"] == "2026-10-02"


def test_invalid_and_cyclic_schedules():
    with pytest.raises(ValidationError):
        Capacity(hours=0)
    with pytest.raises(ValidationError):
        Capacity(weekdays=[])
    with pytest.raises(ValueError, match="依赖"):
        schedule([task(dep="T1")], Capacity())
    with pytest.raises(ValueError, match="重复"):
        schedule([task(), task()], Capacity())
    long = task()
    long.h = 9
    assert all(t["hours"] <= 4 for t in schedule([long], Capacity(concurrency=2)))


def test_static_rules_and_pinned_dependencies(tmp_path):
    (tmp_path / "unsafe.py").write_text(
        'SECRET_KEY = "sensitive-example-secret"\nsql = f"SELECT * FROM users WHERE id={uid}"\nyaml.load(payload)\nsubprocess.call(command, shell=True)\nhashlib.md5(password)\n',
        encoding="utf-8",
    )
    (tmp_path / ".env").write_text('SECRET_KEY="should-not-be-read"')
    (tmp_path / "requirements.txt").write_text("PyYAML==5.3\nFlask>=3\n")
    findings = builtin(tmp_path)
    assert {f["rule"] for f in findings} == {
        "hardcoded-secret",
        "sql-interpolation",
        "unsafe-yaml",
        "shell-true",
        "weak-hash",
    }
    assert all(f["file"] != ".env" for f in findings)
    secret = next(f for f in findings if f["rule"] == "hardcoded-secret")
    assert "sensitive-example-secret" not in secret["code"]
    assert [(e, n, v) for e, n, v, _, _ in dependencies(tmp_path)] == [
        ("PyPI", "PyYAML", "5.3")
    ]


def test_permission_and_paths(tmp_path):
    run = Run(
        repo_id="none", path=str(tmp_path), config={"preset": "readonly", "tools": {}}
    )
    assert permission(run, "read", {}) == "allow"
    assert permission(run, "edit", {}) == "deny"
    run.config = {"preset": "auto", "tools": {}}
    assert permission(run, "bash", {"command": "git status"}) == "allow"
    assert permission(run, "bash", {"command": "Remove-Item -Recurse .."}) == "ask"
    assert permission(run, "bash", {"command": "git push"}) == "ask"
    assert permission(run, "run_tests", {"command": "python -m pytest -q"}) == "allow"
    with pytest.raises(ValueError):
        target_path(run, "../outside")
    with pytest.raises(ValueError):
        target_path(run, ".env")
    with pytest.raises(ValueError):
        target_path(run, ".git/config")


def test_json_updates_persist_and_event_tampering_is_detected(client, tmp_path, monkeypatch):
    login(client, monkeypatch)
    repo = save(
        Repository(
            name="local-test", path=str(tmp_path), source="local", status="ready"
        )
    )
    repo.progress.append({"step": "clone", "status": "complete"})
    save(repo)
    assert get(Repository, repo.id).progress == repo.progress
    run = save(Run(repo_id=repo.id, path=str(tmp_path), config={"preset": "auto"}))
    asyncio.run(emit(run.id, "started", {"path": "workspace"}))
    asyncio.run(emit(run.id, "approval", {"decision": "approve"}))
    events = all_items(Event, run_id=run.id)
    assert verify(events)
    events[0].data = {"path": "tampered"}
    assert not verify(events)
    response = client.get("/api/runs/" + run.id)
    assert response.status_code == 200 and response.json()["hash_valid"]


def test_api_validation_csrf_and_pr_gate(client, tmp_path, monkeypatch):
    repo = save(
        Repository(name="fixture", path=str(tmp_path), source="local", status="ready")
    )
    run = save(
        Run(
            repo_id=repo.id,
            status="completed",
            diff="change",
            tests={"exit_code": 0},
            config={"preset": "auto"},
        )
    )
    assert client.post("/api/runs/" + run.id + "/pr").status_code == 401
    assert (
        client.put(
            "/api/settings", json={}, headers={"Origin": "https://attacker.example"}
        ).status_code
        == 403
    )
    assert (
        client.get("/api/auth/github/callback?code=fake&state=fake").status_code == 400
    )
    login(client, monkeypatch)
    assert (
        client.post(
            "/api/repos/" + repo.id + "/schedule",
            json={"tasks": [task().model_dump(mode="json")], "capacity": {"hours": 0}},
        ).status_code
        == 422
    )
    value = {
        "tasks": [task().model_dump(mode="json")],
        "capacity": Capacity().model_dump(mode="json"),
    }
    # Scheduling is the last step: it needs a drafted plan first.
    assert client.post("/api/repos/" + repo.id + "/schedule", json=value).status_code == 409
    save(Plan(repo_id=repo.id, tasks=[task().model_dump(mode="json")]))
    plan = client.post("/api/repos/" + repo.id + "/schedule", json=value)
    assert plan.status_code == 200
    assert client.get("/api/repos/" + repo.id + "/plans").json()[0]["calendar"]
    assert (
        client.post(
            "/api/repos/" + repo.id + "/runs",
            json={"task": task().model_dump(mode="json"), "config": {"preset": "full"}},
        ).status_code
        == 422
    )
    settings = client.get("/api/settings").json()
    assert "llm_api_key" not in settings and "github_client_secret" not in settings


def test_edit_requires_unique_match_and_invalidates_old_tests(client, tmp_path):
    file = tmp_path / "code.py"
    file.write_text("value = 1\n")
    repo = save(
        Repository(name="editing", path=str(tmp_path), source="local", status="ready")
    )
    run = save(
        Run(
            repo_id=repo.id,
            path=str(tmp_path),
            config={"preset": "approve"},
            tests={"exit_code": 0},
        )
    )
    with pytest.raises(ValueError):
        asyncio.run(
            execute_tool(run, "edit", {"path": "code.py", "old": "missing", "new": "x"})
        )
    asyncio.run(
        execute_tool(
            run, "edit", {"path": "code.py", "old": "value = 1", "new": "value = 2"}
        )
    )
    assert file.read_text() == "value = 2\n" and not get(Run, run.id).tests


def test_tokens_are_encrypted(client):
    value = "private-access-token"
    row = save(
        Token(id="encryption-test", encrypted=fernet.encrypt(value.encode()).decode())
    )
    assert value not in row.encrypted
    assert fernet.decrypt(get(Token, row.id).encrypted.encode()).decode() == value


def test_issue_fts_includes_chinese_substrings_and_comments(client, tmp_path, monkeypatch):
    login(client, monkeypatch)
    from workbench.db import index_issues

    issue = {
        "number": 1,
        "title": "搜索笔记时报错",
        "body": "SQLite 参数错误",
        "state": "open",
        "labels": ["bug"],
        "comments_text": "代码位置 search_notes",
    }
    repo = save(
        Repository(
            name="fts",
            path=str(tmp_path),
            source="local",
            status="ready",
            issues=[issue],
        )
    )
    index_issues(repo)
    for query in ["搜索", "SQLite", "search_notes"]:
        result = client.get(
            "/api/repos/" + repo.id + "/search", params={"q": query, "kind": "issue"}
        )
        assert result.status_code == 200 and result.json()["issues"][0]["number"] == 1
    assert not client.get(
        "/api/repos/" + repo.id + "/search",
        params={"q": "搜索", "kind": "issue", "state": "closed"},
    ).json()["issues"]


def test_commands_keep_full_output_and_separate_stderr():
    import sys

    from workbench.services import command

    result = asyncio.run(
        command(
            [
                sys.executable,
                "-c",
                'import sys; print("stdout"); print("stderr",file=sys.stderr)',
            ]
        )
    )
    assert result["exit_code"] == 0
    assert result["stdout"].strip() == "stdout" and result["stderr"].strip() == "stderr"
    assert "stdout" in result["output"] and "stderr" in result["output"]


def test_runtime_metadata_is_excluded_from_git_diff(tmp_path):
    from workbench.services import exclude_runtime_files, git

    asyncio.run(git("init", str(tmp_path)))
    generated = tmp_path / ".codegraph"
    generated.mkdir()
    (generated / ".gitignore").write_text("*\n!.gitignore\n")
    asyncio.run(exclude_runtime_files(tmp_path))
    assert not asyncio.run(git("status", "--porcelain", cwd=tmp_path))


def test_oauth_callback_creates_encrypted_session_and_refreshes(client, monkeypatch):
    import json
    from types import SimpleNamespace
    from urllib.parse import parse_qs, urlparse

    import workbench.app as routes
    import workbench.services as services
    from workbench.config import settings

    async def exchange(payload):
        return {
            "access_token": "test-private-access",
            "refresh_token": "test-refresh",
            "expires_in": 3600,
        }

    async def profile(*args):
        return {
            "login": "test-maintainer",
            "avatar_url": "https://example.com/avatar",
            "html_url": "https://github.com/test-maintainer",
        }

    monkeypatch.setattr(routes, "oauth_token", exchange)
    monkeypatch.setattr(routes, "github", profile)
    # The login route 503s without OAuth credentials; CI has no backend/.env,
    # so the test must not depend on the developer's local configuration.
    monkeypatch.setattr(settings, "github_client_id", "test-client-id")
    monkeypatch.setattr(settings, "github_client_secret", "test-client-secret")
    response = client.get("/api/auth/github/login", follow_redirects=False)
    assert response.status_code == 307
    state = parse_qs(urlparse(response.headers["location"]).query)["state"][0]
    callback = client.get(
        "/api/auth/github/callback",
        params={"code": "authorized-code", "state": state},
        follow_redirects=False,
    )
    assert callback.status_code == 307
    assert client.get("/api/auth/me").json()["user"]["login"] == "test-maintainer"
    token = next(
        t
        for t in all_items(Token)
        if b"test-private-access" in fernet.decrypt(t.encrypted.encode())
    )
    assert "test-private-access" not in token.encrypted
    token.expires = 1
    save(token)

    async def refresh(payload):
        assert payload["grant_type"] == "refresh_token"
        return {
            "access_token": "renewed-token",
            "refresh_token": "renewed-refresh",
            "expires_in": 3600,
        }

    monkeypatch.setattr(services, "oauth_token", refresh)
    request = SimpleNamespace(session={"token_id": token.id})
    assert asyncio.run(services.github_token(request)) == "renewed-token"
    assert (
        json.loads(fernet.decrypt(get(Token, token.id).encrypted.encode()))[
            "access_token"
        ]
        == "renewed-token"
    )


def test_findings_can_be_ignored_and_restored_in_bulk(client, tmp_path, monkeypatch):
    repo = save(
        Repository(name="fixture", path=str(tmp_path), source="local", status="ready")
    )
    scan = save(
        Scan(
            repo_id=repo.id,
            status="complete",
            findings=[
                {"id": "SEC-1", "status": "open", "review": "疑似误报"},
                {"id": "SEC-2", "status": "open", "review": "确认"},
                {"id": "SEC-3", "status": "open", "review": "疑似误报"},
            ],
        )
    )
    login(client, monkeypatch)
    url = "/api/scans/" + scan.id + "/findings/status"
    done = client.post(url, json={"ids": ["SEC-1", "SEC-3"], "status": "ignored"})
    assert done.status_code == 200
    status = {f["id"]: f["status"] for f in done.json()["findings"]}
    assert status == {"SEC-1": "ignored", "SEC-2": "open", "SEC-3": "ignored"}
    assert client.post(url, json={"ids": ["SEC-9"], "status": "ignored"}).status_code == 404
    assert client.post(url, json={"ids": [], "status": "ignored"}).status_code == 422
    restored = client.post(url, json={"ids": ["SEC-1"], "status": "open"})
    assert {f["id"]: f["status"] for f in restored.json()["findings"]}["SEC-1"] == "open"
    # A person's decision replaces the AI's: restoring clears its attribution.
    ai = save(
        Scan(
            repo_id=repo.id,
            status="complete",
            findings=[{"id": "SEC-1", "status": "ignored", "handled_by": "ai"}],
        )
    )
    back = client.patch(
        "/api/scans/" + ai.id + "/findings/SEC-1", json={"status": "open"}
    )
    assert back.json()["findings"][0] == {"id": "SEC-1", "status": "open"}


def finding(**updates):
    return {
        "id": "SEC-1",
        "title": "Use of assert detected",
        "severity": "low",
        "source": "bandit",
        "rule": "B101",
        "file": "tests/test_search.py",
        "line": 3,
        "code": "assert x",
        "suggestion": "结合上下文验证并修复",
        "review": "未复核",
        "status": "open",
        **updates,
    }


def verdict(**updates):
    return {
        "id": "SEC-1",
        "verdict": "误报",
        "confidence": "high",
        "evidence": "位于 tests/ 下的测试文件，断言不会随生产代码运行",
        "explanation": "pytest 中的 assert 是正常用法",
        "suggestion": "忽略",
        **updates,
    }


def test_triage_proposes_false_positives_but_never_ignores():
    done = triage(finding(), verdict())
    # A confident false-positive claim is recorded as evidence and surfaced,
    # but the finding stays open until a person confirms the ignore.
    assert done["status"] == "open" and done["handled_by"] == "ai"
    assert done["review"] == "疑似误报" and "tests/" in done["evidence"]
    # Anything short of high confidence plus a stated fact waits for a person.
    for weak in (
        verdict(confidence="low"),
        verdict(evidence=""),
        verdict(verdict="需人工"),
    ):
        waiting = triage(finding(), weak)
        assert waiting["status"] == "open" and waiting["review"] == "需人工"
        assert "handled_by" not in waiting
    # High-severity claims are never ignored automatically.
    risky = triage(finding(severity="high"), verdict())
    assert risky["status"] == "open" and risky["review"] == "需人工"
    assert "需要人工" in risky["explanation"]
    # A confirmed finding stays open; an unknown verdict changes nothing.
    assert triage(finding(), verdict(verdict="确认"))["review"] == "确认"
    assert triage(finding(), {"id": "SEC-1", "verdict": "???"}) == finding()


def test_finding_evidence_reads_real_context_and_stays_inside_the_repo(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_search.py").write_text(
        "def test_it():\n    key = 1\n    assert key\n    assert key == 1\n",
        encoding="utf-8",
    )
    (tmp_path / ".env").write_text("TOKEN=abc", encoding="utf-8")
    fact = finding_evidence(tmp_path, finding(line=3))
    assert fact["in_tests"] is True and "3: " in fact["context"]
    assert "assert key" in fact["context"]
    for outside in ("../secret.txt", ".env", "missing.py"):
        assert finding_evidence(tmp_path, finding(file=outside))["context"] == ""


def test_review_applies_verdicts_without_touching_what_the_user_decided(
    tmp_path, monkeypatch
):
    import workbench.security as security

    repo = save(
        Repository(name="fixture", path=str(tmp_path), source="local", status="ready")
    )
    scan = save(
        Scan(
            repo_id=repo.id,
            status="complete",
            findings=[
                finding(id="SEC-1"),
                finding(id="SEC-2", severity="high", rule="B102"),
                finding(id="SEC-3", status="ignored", review="误报"),
            ],
        )
    )
    seen = {}

    async def fake(prompt, context="", actor="", structured=False, purpose=""):
        seen["context"] = context
        return {
            "findings": [
                verdict(id="SEC-1"),
                verdict(id="SEC-2"),
                verdict(id="SEC-3", verdict="确认", confidence="high"),
            ]
        }

    monkeypatch.setattr(security, "ask", fake)
    result = asyncio.run(review_findings(scan, "tester"))
    by_id = {f["id"]: f for f in result.findings}
    assert by_id["SEC-1"]["status"] == "open" and by_id["SEC-1"]["handled_by"] == "ai"
    assert by_id["SEC-1"]["review"] == "疑似误报"
    assert by_id["SEC-2"]["status"] == "open" and by_id["SEC-2"]["review"] == "需人工"
    # Already ignored by a person: not sent to the model, not changed.
    assert by_id["SEC-3"]["review"] == "误报" and "handled_by" not in by_id["SEC-3"]
    assert "SEC-3" not in seen["context"] and "SEC-1" in seen["context"]


def test_planning_follows_scan_and_clearing_resets_to_the_start(
    client, tmp_path, monkeypatch
):
    repo = save(
        Repository(name="fixture", path=str(tmp_path), source="local", status="ready")
    )
    other = save(
        Repository(name="other", path=str(tmp_path), source="local", status="ready")
    )
    login(client, monkeypatch)
    # Planning needs a finished scan; a running one does not count.
    drafted = client.post("/api/repos/" + repo.id + "/plan")
    assert drafted.status_code == 409 and "扫描" in drafted.json()["detail"]
    save(Scan(repo_id=repo.id, status="running"))
    assert client.post("/api/repos/" + repo.id + "/plan").status_code == 409

    scan = save(Scan(repo_id=repo.id, status="complete", findings=[{"id": "SEC-1"}]))
    save(Plan(repo_id=repo.id, tasks=[task().model_dump(mode="json")]))
    save(Plan(repo_id=repo.id, status="applied", calendar=[{"id": "T1"}]))
    keep = save(Plan(repo_id=other.id))
    cleared = client.delete("/api/repos/" + repo.id + "/plans")
    assert cleared.status_code == 200 and cleared.json() == {"deleted": 2}
    assert client.get("/api/repos/" + repo.id + "/plans").json() == []
    # Only this repository's plans go; scans and other repositories are untouched.
    assert get(Scan, scan.id).findings == [{"id": "SEC-1"}]
    assert get(Plan, keep.id).repo_id == other.id
    assert client.post(
        "/api/repos/" + repo.id + "/schedule",
        json={
            "tasks": [task().model_dump(mode="json")],
            "capacity": Capacity().model_dump(mode="json"),
        },
    ).status_code == 409
    assert any(a.action == "plans_cleared" for a in all_items(Audit))


def test_review_survives_a_batch_the_model_cannot_answer(tmp_path, monkeypatch):
    from fastapi import HTTPException

    import workbench.security as security

    repo = save(
        Repository(name="fixture", path=str(tmp_path), source="local", status="ready")
    )
    ids = [f"SEC-{n}" for n in range(1, 9)]
    scan = save(
        Scan(
            repo_id=repo.id,
            status="complete",
            findings=[finding(id=i, severity="medium") for i in ids],
        )
    )
    calls = []

    async def fake(prompt, context="", actor="", structured=False, purpose=""):
        sent = [row["id"] for row in json.loads(context)]
        calls.append(sent)
        # The model's output is cut off whenever it is asked about more than two.
        if len(sent) > 2 or "SEC-6" in sent:
            raise HTTPException(502, "LLM 未返回有效 JSON，请重试")
        return {"findings": [verdict(id=i, verdict="确认") for i in sent]}

    monkeypatch.setattr(security, "ask", fake)
    report = {}
    result = asyncio.run(review_findings(scan, "tester", report))
    by_id = {f["id"]: f for f in result.findings}
    # Big batches are split until the model can answer; only SEC-6 stays unreviewed.
    assert [i for i in ids if by_id[i]["review"] == "未复核"] == ["SEC-6"]
    assert max(len(c) for c in calls) <= 5
    assert report["unreviewed"] == 1


def test_review_keeps_finished_batches_when_the_quota_runs_out(tmp_path, monkeypatch):
    from fastapi import HTTPException

    import workbench.security as security

    repo = save(
        Repository(name="fixture", path=str(tmp_path), source="local", status="ready")
    )
    scan = save(
        Scan(
            repo_id=repo.id,
            status="complete",
            findings=[finding(id=f"SEC-{n}", severity="medium") for n in range(1, 8)],
        )
    )
    state = {"n": 0}

    async def fake(prompt, context="", actor="", structured=False, purpose=""):
        state["n"] += 1
        if state["n"] > 1:
            raise HTTPException(429, "今日访客 LLM 配额不足")
        return {
            "findings": [
                verdict(id=row["id"], verdict="确认") for row in json.loads(context)
            ]
        }

    # One reviewer at a time: without this the batch that wins the quota is
    # thread-pool scheduling order rather than sequence.
    monkeypatch.setattr(security, "REVIEW_PARALLEL", 1)
    monkeypatch.setattr(security, "ask", fake)
    report = {}
    result = asyncio.run(review_findings(scan, "tester", report))
    reviewed = [f["id"] for f in result.findings if f["review"] == "确认"]
    # The first batch finished and its verdicts persist; the quota error then
    # stops everything else without erasing what was already saved.
    assert reviewed == [f"SEC-{n}" for n in range(1, 4)]
    assert report["error"] == "今日访客 LLM 配额不足" and report["unreviewed"] == 4
    assert state["n"] == 2, "stops asking once the quota is gone"


def test_review_can_be_paused_and_resumed_without_redoing_finished_work(
    tmp_path, monkeypatch
):
    import workbench.security as security
    from workbench.security import pause_review

    repo = save(
        Repository(name="fixture", path=str(tmp_path), source="local", status="ready")
    )
    scan = save(
        Scan(
            repo_id=repo.id,
            status="complete",
            findings=[finding(id=f"SEC-{n}", severity="medium") for n in range(1, 8)],
        )
    )
    asked = []

    async def fake(prompt, context="", actor="", structured=False, purpose=""):
        sent = [row["id"] for row in json.loads(context)]
        asked.append(sent)
        if len(asked) == 1:
            # The person pauses while the first batch is with the model.
            assert pause_review(scan.id)
            assert get(Scan, scan.id).sources[0]["status"] == "pausing"
        return {"findings": [verdict(id=i, verdict="确认") for i in sent]}

    monkeypatch.setattr(security, "REVIEW_PARALLEL", 1)
    monkeypatch.setattr(security, "ask", fake)
    paused = asyncio.run(review_findings(scan, "tester"))
    source = paused.sources[0]
    # The batch already with the model finishes and is kept; nothing else is asked.
    assert source["status"] == "paused" and (source["done"], source["total"]) == (3, 7)
    assert len(asked) == 1 and not security.active_reviews
    assert not pause_review(scan.id), "nothing left to pause"

    resumed = asyncio.run(review_findings(get(Scan, scan.id), "tester"))
    assert resumed.sources[0]["status"] == "complete"
    assert [i for batch in asked[1:] for i in batch] == [f"SEC-{n}" for n in range(4, 8)]
    assert all(f["review"] == "确认" for f in resumed.findings)


def test_pause_endpoint_needs_a_running_review(client, tmp_path, monkeypatch):
    repo = save(
        Repository(name="fixture", path=str(tmp_path), source="local", status="ready")
    )
    scan = save(Scan(repo_id=repo.id, status="complete"))
    login(client, monkeypatch)
    response = client.post("/api/scans/" + scan.id + "/review/pause")
    assert response.status_code == 409


def test_pausing_a_review_orphaned_by_a_restart_makes_it_resumable(tmp_path):
    from workbench.security import pause_review

    repo = save(
        Repository(name="fixture", path=str(tmp_path), source="local", status="ready")
    )
    scan = save(
        Scan(
            repo_id=repo.id,
            status="complete",
            findings=[finding(id="SEC-1")],
            sources=[{"name": "AI 复核", "status": "running", "done": 1, "total": 5}],
        )
    )
    # Marked running, but no task is working on it any more.
    assert pause_review(scan.id)
    assert get(Scan, scan.id).sources[0]["status"] == "paused"
    assert not pause_review(scan.id)
