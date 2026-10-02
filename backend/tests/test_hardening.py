import asyncio
import subprocess
import sys
from types import SimpleNamespace

import pytest
from helpers import guest_actor, login

from workbench.agent import describe_error, execute_tool, permission
from workbench.agent import tests_ok as outcome_ok
from workbench.config import safe_error, settings
from workbench.db import Event, Repository, Run, all_items, get, save


def run_of(preset="auto", actor="maintainer", **config):
    return Run(
        repo_id="x",
        actor=actor,
        path=".",
        config={"preset": preset, "tools": {}, **config},
    )


def git_repo(path, files):
    subprocess.run(["git", "init", str(path)], capture_output=True, check=True)
    for name, text in files.items():
        (path / name).parent.mkdir(parents=True, exist_ok=True)
        (path / name).write_text(text, encoding="utf-8")
    subprocess.run(["git", "-C", str(path), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(path), "-c", "user.name=t", "-c", "user.email=t@t"]
        + ["commit", "-m", "init"],
        capture_output=True,
        check=True,
    )


# ── guest access control ─────────────────────────────────────────────


def test_guest_cannot_change_settings_audit_or_import_local(client, tmp_path):
    body = {
        "llm_base_url": "http://attacker.example/v1",
        "llm_model": "m",
        "workspace_dir": str(tmp_path),
    }
    assert client.put("/api/settings", json=body).status_code == 401
    assert client.get("/api/audit").status_code == 401
    assert client.get("/api/audit/export").status_code == 401
    assert (
        client.post("/api/repos/import", json={"local_path": str(tmp_path)}).status_code
        == 401
    )


def test_guest_cannot_see_or_use_local_repositories(client, tmp_path):
    repo = save(
        Repository(name="local-only", path=str(tmp_path), source="local", status="ready")
    )
    assert repo.id not in [r["id"] for r in client.get("/api/repos").json()]
    assert client.get("/api/repos/" + repo.id).status_code == 401
    assert (
        client.post(
            "/api/repos/" + repo.id + "/runs",
            json={"task": {"id": "T", "title": "x", "h": 1}},
        ).status_code
        == 401
    )


def test_guest_cannot_use_full_permission_or_custom_directory(client):
    repo = save(
        Repository(
            name=settings.demo_repo, path=".", source="github", status="ready"
        )
    )
    task = {"id": "T", "title": "x", "h": 1}
    for config in (
        {"preset": "full", "full_confirmed": True},
        {"preset": "approve", "directory": "C:/anywhere/run"},
        {"preset": "approve", "test_command": "echo ok"},
    ):
        response = client.post(
            "/api/repos/" + repo.id + "/runs", json={"task": task, "config": config}
        )
        assert response.status_code == 401, config


def test_guest_agent_has_no_bash_and_no_custom_test_command():
    guest = run_of("auto", actor="guest:1.2.3.4")
    assert permission(guest, "bash", {"command": "pytest"}) == "deny"
    assert permission(guest, "read", {}) == "allow"


def test_logged_in_user_can_use_privileged_features(client, monkeypatch, tmp_path):
    assert login(client, monkeypatch).status_code == 307
    body = {
        "llm_base_url": "https://llm.example/v1",
        "llm_model": "m",
        "workspace_dir": str(tmp_path),
        "bash_allow": ["^make test$"],
        "bash_deny": ["curl"],
    }
    assert client.put("/api/settings", json=body).status_code == 200
    assert client.get("/api/audit").status_code == 200
    bad = {**body, "bash_deny": ["("]}
    assert client.put("/api/settings", json=bad).status_code == 422


def test_oauth_allowlist(client, monkeypatch):
    monkeypatch.setattr(settings, "allowed_github_users", "someone-else")
    assert login(client, monkeypatch, "intruder").status_code == 403
    assert client.get("/api/auth/me").json()["user"] is None
    monkeypatch.setattr(settings, "allowed_github_users", "Maintainer, other")
    assert login(client, monkeypatch, "maintainer").status_code == 307


# ── test-result gate ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "command",
    [
        "git status",
        "pytest --collect-only",
        "python -m pytest --co -q",
        "pytest --help",
        "echo ok",
    ],
)
def test_run_tests_rejects_commands_that_do_not_run_tests(command, tmp_path):
    run = run_of("auto")
    assert permission(run, "run_tests", {"command": command}) != "allow"
    run.path = str(tmp_path)
    with pytest.raises(ValueError, match="测试"):
        asyncio.run(execute_tool(run, "run_tests", {"command": command}))


def test_run_tests_accepts_configured_custom_command(tmp_path):
    run = run_of("full", test_command="python -c pass")
    run.path = str(tmp_path)
    result = asyncio.run(
        execute_tool(run, "run_tests", {"command": "python -c pass"})
    )
    assert result["exit_code"] == 0


def test_pytest_success_requires_executed_tests():
    assert outcome_ok({"exit_code": 0})
    assert not outcome_ok({"exit_code": 1, "command": "pytest", "output": "1 failed"})
    assert not outcome_ok({"exit_code": 0, "command": "pytest -q", "output": "no tests ran"})
    assert outcome_ok({"exit_code": 0, "command": "pytest -q", "output": "3 passed in 0.1s"})
    assert outcome_ok({"exit_code": 0, "command": "npm test", "output": "ok"})


def test_pr_gate_rejects_runs_that_are_not_finished(client, monkeypatch, tmp_path):
    login(client, monkeypatch)
    repo = save(Repository(name="o/r", path=str(tmp_path), status="ready"))
    run = save(
        Run(
            repo_id=repo.id,
            status="needs_review",
            diff="d",
            task={"title": "fix"},
            config={"preset": "auto"},
            tests={"exit_code": 0, "command": "pytest -q", "output": "3 passed"},
        )
    )
    assert client.post("/api/runs/" + run.id + "/pr").status_code == 409


# ── output fidelity ──────────────────────────────────────────────────


def test_safe_error_keeps_ordinary_text_and_redacts_real_tokens():
    text = "Flask-SQLAlchemy==3.0 task-list disk-usage risk-score ghost_run"
    assert safe_error(text) == text
    secret = "sk-" + "a1B2" * 8
    assert safe_error("key " + secret) == "key [redacted]"
    assert safe_error("ghp_" + "x" * 30) == "[redacted]"
    assert safe_error("github_pat_" + "Y" * 30) == "[redacted]"


def test_safe_error_ignores_placeholder_secrets(monkeypatch):
    monkeypatch.setattr(settings, "demo_github_token", "0")
    assert safe_error("503: 请配置") == "503: 请配置"


# ── approvals and SSE ────────────────────────────────────────────────


def test_approval_records_the_person_who_decided(client, monkeypatch):
    from workbench.agent import approvals

    login(client, monkeypatch, "reviewer")
    repo = save(Repository(name="o/r", path=".", status="ready"))
    run = save(Run(repo_id=repo.id, actor="starter", config={"preset": "approve"}))

    async def decide():
        future = asyncio.get_running_loop().create_future()
        approvals["a-1"] = (run.id, future)
        return future

    loop = asyncio.new_event_loop()
    future = loop.run_until_complete(decide())
    response = client.post(
        "/api/runs/" + run.id + "/approvals/a-1", json={"decision": "approve"}
    )
    assert response.status_code == 200
    assert future.result() == ("approve", "reviewer")
    loop.close()
    approvals.pop("a-1", None)


def test_sse_ignores_malformed_last_event_id(client, tmp_path):
    repo = save(Repository(name=settings.demo_repo, path=str(tmp_path), status="ready"))
    run = save(Run(repo_id=repo.id, actor=guest_actor(client), status="completed", config={"preset": "auto"}))
    response = client.get(
        "/api/runs/" + run.id + "/events", headers={"last-event-id": "abc"}
    )
    assert response.status_code == 200


def test_empty_timeout_error_is_described():
    assert "超时" in describe_error(asyncio.TimeoutError())
    assert describe_error(ValueError("boom")) == "boom"


# ── configurable bash lists ──────────────────────────────────────────


def test_bash_deny_and_allow_lists():
    run = run_of("auto", bash_deny=["^npm publish"], bash_allow=[r"^make test$"])
    assert permission(run, "bash", {"command": "npm publish"}) == "deny"
    assert permission(run, "bash", {"command": "make test"}) == "allow"
    assert permission(run, "bash", {"command": "make deploy"}) == "ask"
    approve = run_of("approve", bash_allow=[r"^make test$"])
    assert permission(approve, "bash", {"command": "make test"}) == "ask"


# ── PR from a fork when the user cannot push ─────────────────────────


def test_pr_uses_fork_when_user_has_no_push_access(client, monkeypatch, tmp_path):
    import workbench.app as routes

    login(client, monkeypatch, "contributor")
    repo = save(
        Repository(name="owner/demo", path=str(tmp_path), branch="main", status="ready")
    )
    run = save(
        Run(
            repo_id=repo.id,
            status="completed",
            diff="d",
            branch="owb/run-1",
            path=str(tmp_path),
            commit_sha="abc",
            task={"title": "fix"},
            config={"preset": "auto"},
            tests={"exit_code": 0},
        )
    )
    calls, pushes = [], []

    async def fake_github(path, token="", method="GET", payload=None):
        calls.append((method, path, payload))
        if path == "/repos/owner/demo":
            return {"permissions": {"push": False}}
        if path == "/repos/owner/demo/forks":
            return {"full_name": "contributor/demo"}
        if path == "/repos/contributor/demo":
            return {"full_name": "contributor/demo"}
        if path == "/repos/owner/demo/pulls":
            return {"html_url": "https://github.com/owner/demo/pull/1"}
        return {}

    async def fake_git(*args, **kwargs):
        if args and args[0] == "push":
            pushes.append(args)
        return "abc"

    monkeypatch.setattr(routes, "github", fake_github)
    monkeypatch.setattr(routes, "git", fake_git)
    result = client.post("/api/runs/" + run.id + "/pr")
    assert result.status_code == 200, result.text
    assert pushes and "contributor/demo" in " ".join(pushes[0])
    pull = next(c for c in calls if c[1].endswith("/pulls"))
    assert pull[2]["head"] == "contributor:owb/run-1" and "127.0.0.1" not in pull[2]["body"]


def test_invalid_stored_token_forces_relogin(client, monkeypatch):
    from workbench.db import Token

    login(client, monkeypatch)
    for token in all_items(Token):
        token.encrypted = "not-a-fernet-token"
        save(token)
    assert client.get("/api/github/repos").status_code == 401
    assert client.get("/api/auth/me").json()["user"] is None


# ── agent loop limits keep the work ──────────────────────────────────


def fake_llm(monkeypatch, tool_name="list_files"):
    import workbench.agent as agent

    def message(*_):
        call = SimpleNamespace(
            id="c1",
            function=SimpleNamespace(name=tool_name, arguments="{}"),
            model_dump=lambda: {"id": "c1"},
        )
        return (
            SimpleNamespace(
                content="",
                tool_calls=[call],
                model_dump=lambda exclude_none=True: {"role": "assistant"},
            ),
            10,
        )

    async def chat(*args, **kwargs):
        return message()

    async def codegraph(*args, **kwargs):
        return {"exit_code": 0, "output": "", "stdout": ""}

    monkeypatch.setattr(agent, "chat", chat)
    monkeypatch.setattr(agent, "codegraph", codegraph)


def test_step_limit_keeps_diff_and_needs_review(client, monkeypatch, tmp_path):
    from workbench.agent import run_agent

    source = tmp_path / "src"
    git_repo(source, {"a.py": "x = 1\n", "tests/test_a.py": "def test_a():\n    assert True\n"})
    fake_llm(monkeypatch)
    repo = save(Repository(name="local", path=str(source), source="local", status="ready"))
    run = save(
        Run(
            repo_id=repo.id,
            actor="maintainer",
            task={"id": "T"},
            config={
                "preset": "auto",
                "tools": {},
                "directory": str(tmp_path / "work"),
                "max_steps": 2,
                "max_tokens": 100000,
            },
        )
    )
    asyncio.run(run_agent(run.id))
    done = get(Run, run.id)
    assert done.status == "needs_review", done.error
    assert done.tests and "passed" in done.tests["output"]


def test_missing_test_framework_does_not_fail_the_run(client, monkeypatch, tmp_path):
    from workbench.agent import run_agent

    source = tmp_path / "src"
    git_repo(source, {"a.txt": "x\n"})
    fake_llm(monkeypatch, "list_files")
    repo = save(Repository(name="local2", path=str(source), source="local", status="ready"))
    run = save(
        Run(
            repo_id=repo.id,
            actor="maintainer",
            task={"id": "T"},
            config={
                "preset": "auto",
                "tools": {},
                "directory": str(tmp_path / "work"),
                "max_steps": 1,
                "max_tokens": 100000,
            },
        )
    )
    asyncio.run(run_agent(run.id))
    done = get(Run, run.id)
    assert done.status == "needs_review", done.error
    assert any(e.kind == "tests_skipped" for e in all_items(Event, run_id=run.id))


# ── Windows .cmd shims ───────────────────────────────────────────────


def shim_env(monkeypatch, tmp_path, cmd_text, script="lib/cli.js"):
    import workbench.services as services

    cmd = tmp_path / "bin" / "tool.cmd"
    cmd.parent.mkdir(parents=True)
    cmd.write_text(cmd_text, encoding="utf-8")
    if script:
        (tmp_path / script).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / script).write_text("", encoding="utf-8")
    found = {"tool": str(cmd), "node": "C:/node/node.exe"}
    monkeypatch.setattr(services.shutil, "which", lambda name, path=None: found.get(name))
    return services


@pytest.mark.skipif(
    sys.platform != "win32", reason="npm 的 .cmd 垫脚只在 Windows 上生成"
)
def test_cmd_shim_script_is_read_from_the_shim_itself(monkeypatch, tmp_path):
    shim = (
        '@ECHO off\nSET dp0=%~dp0\n"%_prog%"  "%dp0%\\..\\lib\\cli.js" %*\n'
    )
    services = shim_env(monkeypatch, tmp_path, shim)
    argv = services.resolve_executable("tool")
    assert argv[0] == "C:/node/node.exe"
    assert argv[1] == str((tmp_path / "lib" / "cli.js").resolve())


def test_unresolvable_cmd_shim_names_the_file(monkeypatch, tmp_path):
    services = shim_env(monkeypatch, tmp_path, "@ECHO off\nrem nothing\n", script=None)
    with pytest.raises(RuntimeError) as error:
        services.resolve_executable("tool")
    assert "tool.cmd" in str(error.value)


def test_public_deployment_is_view_only_for_guests(client, monkeypatch):
    from workbench.config import DEMO_NOTICE

    # Local deployments keep working without a GitHub login.
    assert client.post("/api/repos/none/ask", json={}).status_code != 403
    monkeypatch.setattr(settings, "public_url", "https://www.signoff.top")
    blocked = client.post("/api/repos/none/ask", json={}, headers={"origin": "https://www.signoff.top"})
    assert blocked.status_code == 403 and blocked.json() == {"detail": DEMO_NOTICE}
    assert "github.com/JiaMingWang-CN/signoff" in DEMO_NOTICE
    assert client.get("/api/repos").status_code == 200
    assert client.post("/api/auth/logout", headers={"origin": "https://www.signoff.top"}).status_code == 200
