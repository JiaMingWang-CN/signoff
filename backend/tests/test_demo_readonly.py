import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from helpers import guest_actor, login

import workbench.agent as agent
import workbench.app as routes
from workbench.config import settings
from workbench.db import Event, Repository, Run, all_items, get, save
from workbench.sync import auto_sync_due


@pytest.fixture
def demo(client, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")
    return save(Repository(name=settings.demo_repo, path=str(tmp_path), status="ready"))


@pytest.fixture
def no_execution(monkeypatch):
    calls = []

    async def forbidden(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError("Demo must not execute commands or create a PR")

    for module, names in [(agent, ("command", "git", "codegraph", "exclude_runtime_files")),
                          (routes, ("git", "github", "github_token", "codegraph"))]:
        for name in names:
            monkeypatch.setattr(module, name, forbidden)
    return calls


@pytest.mark.parametrize("preset", ["approve", "auto", "full"])
def test_demo_tools_only_change_virtual_files(demo, no_execution, preset):
    run = save(Run(repo_id=demo.id, path=demo.path, actor="maintainer",
                   config=agent.RunConfig(preset=preset, full_confirmed=True).model_dump()))
    result = asyncio.run(agent.execute_tool(run, "edit", {"path": "a.py", "old": "x = 1", "new": "x = 2"}))
    assert result["simulated"] is True
    assert asyncio.run(agent.execute_tool(run, "read", {"path": "a.py"})) == "x = 2\n"
    asyncio.run(agent.execute_tool(run, "write", {"path": "tests/test_demo.py", "content": "raise RuntimeError('never execute')\n"}))
    assert "tests/test_demo.py" in asyncio.run(agent.execute_tool(run, "list_files", {}))
    tests = asyncio.run(agent.execute_tool(run, "run_tests", {"command": "python -m pytest -q"}))
    assert tests["simulated"] is True and tests["exit_code"] is None
    assert not agent.tests_ok(tests)
    assert not agent.tests_ok({"simulated": True, "exit_code": 0, "command": "pytest", "output": "1 passed"})
    shell = asyncio.run(agent.execute_tool(run, "bash", {"command": "git push origin main"}))
    assert shell["simulated"] is True and shell["exit_code"] is None
    diff = asyncio.run(agent.execute_tool(run, "git_diff", {}))
    assert "-x = 1" in diff and "+x = 2" in diff
    assert (Path(demo.path) / "a.py").read_text() == "x = 1\n"
    assert not (Path(demo.path) / "tests").exists()
    assert not no_execution
    # The overlay survives another request/turn, without changing the source.
    restored = get(Run, run.id)
    assert asyncio.run(agent.execute_tool(restored, "read", {"path": "a.py"})) == "x = 2\n"
    asyncio.run(agent.execute_tool(restored, "write", {"path": "new.txt", "content": "no newline"}))
    assert "+no newline\n\\ No newline at end of file\n" in asyncio.run(agent.execute_tool(restored, "git_diff", {}))
    with pytest.raises(ValueError, match="工作区"):
        asyncio.run(agent.execute_tool(run, "write", {"path": "../outside.py", "content": "x"}))


def test_demo_readonly_cannot_be_widened_with_tool_overrides(demo, no_execution):
    run = save(Run(repo_id=demo.id, path=demo.path, config=agent.RunConfig(
        preset="readonly", tools={"write": "allow", "run_tests": "allow"}).model_dump()))
    for name, args in [("write", {"path": "a.py", "content": "x"}), ("run_tests", {"command": "pytest"})]:
        assert agent.permission(run, name, args) == "deny"
        with pytest.raises(ValueError, match="只读"):
            asyncio.run(agent.execute_tool(run, name, args))
    assert not no_execution


def test_demo_agent_and_follow_up_never_create_a_worktree_or_run_tests(demo, monkeypatch, no_execution):
    def say(text, calls=()):
        tools = []
        for index, (name, args) in enumerate(calls):
            data = {"id": str(index), "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
            tools.append(SimpleNamespace(
                id=data["id"], function=SimpleNamespace(**data["function"]),
                model_dump=lambda data=data: data,
            ))
        message = {"role": "assistant", "content": text, "tool_calls": [t.model_dump() for t in tools]}
        return SimpleNamespace(content=text, tool_calls=tools, model_dump=lambda **kwargs: message), 1

    queue = [say("预览修改", [("edit", {"path": "a.py", "old": "x = 1", "new": "x = 2"})]), say("模拟完成")]

    async def chat(*args, **kwargs):
        return queue.pop(0)

    monkeypatch.setattr(agent, "chat", chat)
    run = save(Run(repo_id=demo.id, task={"title": "fix"}, actor="maintainer",
                   config=agent.RunConfig(preset="full", full_confirmed=True).model_dump()))
    asyncio.run(agent.run_agent(run.id))
    done = get(Run, run.id)
    assert done.status == "completed", done.error
    assert done.config["simulated"] is True and not done.branch and not done.commit_sha
    assert done.path == demo.path and "+x = 2" in done.diff
    assert done.tests["simulated"] is True and done.tests["exit_code"] is None
    queue += [say("继续预览", [("edit", {"path": "a.py", "old": "x = 2", "new": "x = 3"})]), say("模拟完成")]
    asyncio.run(agent.run_agent(run.id, "继续"))
    assert "+x = 3" in get(Run, run.id).diff
    assert agent.verify(all_items(Event, run_id=run.id))
    assert not no_execution


@pytest.mark.parametrize("logged_in", [False, True])
def test_demo_sync_and_pr_are_previews_for_everyone(client, monkeypatch, demo, no_execution, logged_in):
    if logged_in:
        login(client, monkeypatch)
        # Login replaces the GitHub stub, so guard it again after logging in.
        async def forbidden(*args, **kwargs):
            no_execution.append(args)
            raise AssertionError("No GitHub mutation for demo")
        monkeypatch.setattr(routes, "github", forbidden)
    before = get(Repository, demo.id).model_dump()
    sync = client.post(f"/api/repos/{demo.id}/sync", json={"mode": "full"})
    assert sync.status_code == 200 and sync.json()["simulated"] is True
    assert get(Repository, demo.id).model_dump() == before
    run = save(Run(repo_id=demo.id, actor=guest_actor(client) if not logged_in else "maintainer", status="completed", task={"title": "fix"}, diff="preview"))
    pr = client.post(f"/api/runs/{run.id}/pr")
    assert pr.status_code == 200 and pr.json()["simulated"] is True
    assert not pr.json()["url"] and not get(Run, run.id).pr_url
    assert not no_execution
    assert not auto_sync_due(demo, {"auto_sync_enabled": True}, 10**12)


def test_logged_in_full_run_is_forced_to_simulation(client, monkeypatch, demo):
    login(client, monkeypatch)

    async def noop(*args):
        return None

    monkeypatch.setattr(routes, "run_agent", noop)
    response = client.post(f"/api/repos/{demo.id}/runs", json={
        "task": {"id": "manual", "title": "preview", "h": 1},
        "config": {"preset": "full", "full_confirmed": True, "directory": "outside",
                   "test_command": "arbitrary command", "tools": {"bash": "allow"}, "simulated": False},
    })
    assert response.status_code == 200
    run = get(Run, response.json()["id"])
    routes.jobs.pop(run.id, None)
    assert run.config["simulated"] is True and run.config["preset"] == "approve"
    assert run.config["tools"] == {} and not run.config["directory"] and not run.config["test_command"]
    assert client.get(f"/api/repos/{demo.id}").json()["demo"] is True


def test_demo_background_sync_and_cleanup_do_not_touch_legacy_worktrees(demo, no_execution):
    old = save(Run(repo_id=demo.id, status="stopped", path=demo.path,
                   finished="2000-01-01T00:00:00+00:00"))
    asyncio.run(routes.import_repository(demo.id, "token", "maintainer", "full", "manual"))
    asyncio.run(routes.reclaim_worktrees())
    assert get(Run, old.id).path == demo.path and (Path(demo.path) / "a.py").exists()
    assert not no_execution
