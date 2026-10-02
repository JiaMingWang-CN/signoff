"""Regression tests for the 2026-09 security and robustness fixes."""

import asyncio
import os
import sys

import pytest
from helpers import login

from workbench.agent import blocks_commit, execute_tool, permission
from workbench.config import settings
from workbench.db import (
    Repository,
    Run,
    count_items,
    events_after,
    get,
    save,
)
from workbench.security import triage
from workbench.services import command


def settings_body(tmp_path, **over):
    value = {
        "llm_base_url": "https://llm.example/v1",
        "llm_model": "m",
        "workspace_dir": str(tmp_path),
    }
    value.update(over)
    return value


def demo_repo(tmp_path):
    return save(
        Repository(
            name=settings.demo_repo,
            path=str(tmp_path),
            source="github",
            status="ready",
        )
    )


def task():
    return {"id": "T", "title": "fix it", "h": 1}


# -- S1: the server, not the client, decides a guest run permissions -------


def test_guest_auto_preset_is_rejected_with_landing_zone_signed_out(client, tmp_path):
    repo = demo_repo(tmp_path)
    for config in (
        {"preset": "auto"},
        {"preset": "full", "full_confirmed": True},
    ):
        response = client.post(
            "/api/repos/" + repo.id + "/runs",
            json={"task": task(), "config": config},
        )
        assert response.status_code == 401, config


def test_guest_client_tool_overrides_are_stripped_server_side(client, tmp_path, monkeypatch):
    import workbench.app as routes

    repo = demo_repo(tmp_path)
    launched = {}

    async def noop(run_id):
        launched["run"] = run_id

    monkeypatch.setattr(routes, "run_agent", noop)
    response = client.post(
        "/api/repos/" + repo.id + "/runs",
        json={
            "task": task(),
            "config": {
                "preset": "approve",
                "tools": {"write": "allow", "run_tests": "allow"},
            },
        },
    )
    assert response.status_code == 200
    run = get(Run, response.json()["id"])
    # The noop run left a finished task in the global jobs map; a task from
    # this request loop must not survive into the next TestClient lifespan.
    routes.jobs.pop(run.id, None)
    # The client cannot widen its own permissions; the overrides are gone.
    assert run.config["tools"] == {}
    assert run.config["bash_allow"] == [] and run.config["bash_deny"] == []
    # Demo operations are virtual even when allowed; no command is executed.
    assert run.config["simulated"] is True
    assert permission(run, "write", {}) == "allow"
    assert permission(run, "run_tests", {"command": "pytest -q"}) == "allow"


# -- S2: an anonymous bystander cannot decide or stop another run ------------


def test_decide_and_stop_require_the_runner_or_a_login(client, tmp_path):
    repo = demo_repo(tmp_path)
    run = save(Run(repo_id=repo.id, actor="guest:9.9.9.9", config={"preset": "approve"}))
    assert client.post("/api/runs/" + run.id + "/approvals/whatever", json={"decision": "approve"}).status_code == 404
    assert client.post("/api/runs/" + run.id + "/stop").status_code == 404
    # The actor that started it may still decide and stop its own run.
    from helpers import guest_actor

    run.actor = guest_actor(client)
    save(run)
    assert client.post("/api/runs/" + run.id + "/stop").status_code == 409  # not running


# -- S3: the LLM endpoint and the settings that expose host facts -------------


def test_llm_base_url_must_be_https_unless_loopback(client, monkeypatch, tmp_path):
    assert login(client, monkeypatch).status_code == 307
    for bad in (
        "http://attacker.example/v1",
        "ftp://llm.example/v1",
        "http://user:secret@llm.example/v1",
        "https://10.0.0.1/v1",
        "not a url",
    ):
        response = client.put("/api/settings", json=settings_body(tmp_path, llm_base_url=bad))
        assert response.status_code == 422, bad
    for good in ("https://llm.example/v1", "http://127.0.0.1:11434/v1", "http://localhost:8000/v1"):
        response = client.put("/api/settings", json=settings_body(tmp_path, llm_base_url=good))
        assert response.status_code == 200, good


def test_settings_read_and_connection_test_require_login(client, monkeypatch):
    # A guest sees only what its pages render: no paths, tools or endpoint.
    guest = client.get("/api/settings").json()
    assert set(guest) == {
        "llm_configured",
        "sync_mode",
        "auto_sync_enabled",
        "auto_sync_interval",
        "max_steps",
        "max_tokens",
    }
    assert client.post("/api/settings/test").status_code == 401
    login(client, monkeypatch)
    full = client.get("/api/settings").json()
    assert "workspace_dir" in full and "llm_base_url" in full and "tools" in full


def test_login_is_refused_when_exposed_without_an_allowlist(client, monkeypatch):
    monkeypatch.setattr(settings, "github_client_id", "id")
    monkeypatch.setattr(settings, "github_client_secret", "secret")
    monkeypatch.setattr(settings, "public_url", "https://workbench.example.com")
    monkeypatch.setattr(settings, "allowed_github_users", "")
    response = client.get("/api/auth/github/login", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "https://workbench.example.com/repos?notice=entry-unavailable"
    monkeypatch.setattr(settings, "public_url", "http://127.0.0.1:5173")
    # follow_redirects=False: the 307 points at the real GitHub authorize URL.
    assert client.get("/api/auth/github/login", follow_redirects=False).status_code == 307


# -- M1/M2: untrusted input reaching CLI tools and the commit guard -----------


def test_search_code_rejects_flag_and_oversized_queries(tmp_path):
    run = save(Run(repo_id="x", path=str(tmp_path), config={"preset": "approve"}))
    for bad in ("-h", "", "x" * 501):
        with pytest.raises(ValueError):
            asyncio.run(execute_tool(run, "search_code", {"query": bad}))


def test_commit_guard_tokenizes_and_follows_continuations():
    assert blocks_commit("git push origin main")
    assert blocks_commit("git commit -m x")
    assert blocks_commit("git \\\npush origin main")
    assert blocks_commit("git.exe push origin main")
    assert blocks_commit("gh pr create")
    assert blocks_commit("git config alias.p push")
    assert blocks_commit("echo ok; git commit --amend")
    for harmless in (
        "git status",
        "git diff HEAD",
        "gh repo view",
        "echo git push",
        "git stash list",
    ):
        assert not blocks_commit(harmless), harmless


@pytest.mark.parametrize(
    "command",
    [
        'bash -c "git push"',
        "sh -lc 'git commit -m x'",
        'pwsh -NoProfile -Command "git push origin"',
        "powershell -Command git push",
        "cmd /c git push",
        "eval git push",
        "/usr/bin/git push",
        r'& "C:\Program Files\Git\cmd\git.exe" push',
        "env git push",
        "GIT_DIR=x git push",
        "sudo -u me git push",
        "(git push)",
        "echo $(git push)",
        "echo `git push`",
        'g""it push',
        "g`it push",
        'bash -c "git status; gh pr create"',
    ],
)
def test_commit_guard_sees_through_wrappers(command):
    assert blocks_commit(command), command


def test_subprocesses_do_not_inherit_the_database_url():
    original = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = "postgresql://user:secret@db.example/app"
    try:
        result = asyncio.run(
            command(
                [sys.executable, "-c", "import os; print(os.environ.get('DATABASE_URL', 'ABSENT'))"],
            )
        )
        assert "ABSENT" in result["stdout"]
        assert "secret" not in result["output"]
    finally:
        if original is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = original


# -- H2: an approval cannot wait forever --------------------------------------


def test_approval_times_out_and_fails_the_step(tmp_path, monkeypatch):
    from workbench.agent import approval

    monkeypatch.setattr(settings, "agent_approval_timeout_seconds", 0)
    run = save(Run(repo_id="x", path=str(tmp_path), config={"preset": "approve"}))
    with pytest.raises(RuntimeError, match="审批"):
        asyncio.run(approval(run, "write", {"path": "x.py", "content": "x"}))
    assert get(Run, run.id).status == "waiting"


# -- H4: the FTS index repairs itself when it falls behind -------------------


def test_fts_index_is_rebuilt_when_it_falls_behind(tmp_path):
    from workbench.db import engine, fts_count, index_issues, initialize

    repo = save(
        Repository(
            name="fts-repair",
            path=str(tmp_path),
            source="local",
            status="ready",
            issues=[{"number": 1, "title": "缺口", "body": "", "state": "open"}],
        )
    )
    index_issues(repo)
    assert fts_count(repo.id) == 1
    with engine.begin() as connection:
        connection.exec_driver_sql("DELETE FROM issue_fts WHERE repo_id = ?", (repo.id,))
    initialize()  # a crash between save and index would end exactly here
    assert fts_count(repo.id) == 1


# -- H5: AI false positives wait for a person ---------------------------------


def test_ai_false_positive_stays_open_and_marks_handled_by():
    done = triage(
        {"id": "SEC-1", "severity": "medium", "status": "open"},
        {
            "id": "SEC-1",
            "verdict": "误报",
            "confidence": "high",
            "evidence": "tests/fixtures 中的假凭据",
            "explanation": "",
            "suggestion": "忽略",
        },
    )
    assert done["status"] == "open" and done["handled_by"] == "ai"
    assert done["review"] == "疑似误报"


# -- M5 helpers stay sound under load ----------------------------------------


def test_events_after_returns_only_newer_ids(tmp_path):
    from workbench.db import Event

    run = save(Run(repo_id="x", path=str(tmp_path), config={"preset": "approve"}))
    stored = [save(Event(run_id=run.id, kind="note", data={"n": n})) for n in range(3)]
    ids = [event.id for event in stored]
    assert [event.id for event in events_after(run.id, 0)] == ids
    assert [event.id for event in events_after(run.id, ids[0])] == ids[1:]
    assert count_items(Event, run_id=run.id) == 3



# -- review follow-ups ---------------------------------------------------------


def test_reclaim_keeps_unpushed_work_and_removes_finished_worktrees(tmp_path, monkeypatch):
    from workbench import app as app_module

    repo = save(Repository(name="o/r", path=str(tmp_path), status="ready"))
    old = "2026-01-01T00:00:00+00:00"

    def run_with(name, **fields):
        path = tmp_path / name
        path.mkdir()
        return save(Run(repo_id=repo.id, path=str(path), finished=old, **fields))

    unpushed = run_with("unpushed", status="completed")
    review = run_with("review", status="needs_review")
    pushed = run_with("pushed", status="completed", pr_url="https://github.com/o/r/pull/1")
    failed = run_with("failed", status="failed")
    stopped = run_with("stopped", status="stopped")
    recent = save(
        Run(repo_id=repo.id, path=str(tmp_path), status="failed", finished="2999-01-01")
    )
    removed = []

    async def fake_git(*args, cwd=None, token=""):
        if args[:2] == ("worktree", "remove"):
            removed.append(args[-1])
        return ""

    monkeypatch.setattr(app_module, "git", fake_git)
    asyncio.run(app_module.reclaim_worktrees())
    assert sorted(removed) == sorted([pushed.path, failed.path, stopped.path])
    for kept in (unpushed, review, recent):
        assert kept.path not in removed


def test_guest_quota_address_uses_only_the_proxy_appended_hop():
    from types import SimpleNamespace

    from workbench.identity import client_address

    def request(host, forwarded=None):
        headers = {"x-forwarded-for": forwarded} if forwarded else {}
        return SimpleNamespace(session={}, client=SimpleNamespace(host=host), headers=headers)

    # Two visitors behind the bundled proxy are two guests, not one.
    assert client_address(request("127.0.0.1", "203.0.113.5")) == "203.0.113.5"
    assert client_address(request("127.0.0.1", "203.0.113.6")) == "203.0.113.6"
    # A client-supplied entry ahead of the proxy's own is ignored.
    assert client_address(request("127.0.0.1", "198.51.100.1, 203.0.113.5")) == "203.0.113.5"
    # A direct, non-loopback peer cannot name another address.
    assert client_address(request("198.51.100.7", "203.0.113.5")) == "198.51.100.7"
    assert client_address(request("127.0.0.1")) == "127.0.0.1"


def test_tokens_stored_with_the_previous_key_still_decrypt():
    import base64
    import hashlib

    from cryptography.fernet import Fernet

    from workbench.services import fernet

    legacy = Fernet(
        base64.urlsafe_b64encode(hashlib.sha256(settings.app_secret.encode()).digest())
    )
    stored = legacy.encrypt(b"old-token")
    assert fernet.decrypt(stored) == b"old-token"
    # New writes use the separate v1 key, which the legacy key cannot read.
    with pytest.raises(Exception):
        legacy.decrypt(fernet.encrypt(b"new-token"))
