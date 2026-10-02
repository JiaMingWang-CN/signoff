import asyncio
from types import SimpleNamespace

from helpers import login
from test_hardening import git_repo

import workbench.agent as agent
from workbench.db import Event, Repository, Run, all_items, get, save


def stored_run(repo, **over):
    return save(
        Run(
            repo_id=repo.id,
            status="needs_review",
            diff="d",
            branch="owb/run-1",
            task={"title": "fix"},
            config={"preset": "auto"},
            tests={"exit_code": 1, "command": "pytest", "output": "1 failed"},
            **over,
        )
    )


def local_repo(tmp_path):
    return save(
        Repository(name="owner/demo", path=str(tmp_path), branch="main", status="ready")
    )


def test_a_run_needing_review_can_be_accepted_or_rejected_by_a_person(
    client, monkeypatch, tmp_path
):
    repo = local_repo(tmp_path)
    first, second, empty = (stored_run(repo), stored_run(repo), stored_run(repo))
    empty.diff = ""
    save(empty)
    # Guests cannot review.
    assert (
        client.post("/api/runs/" + first.id + "/review", json={"decision": "accept"}).status_code
        == 401
    )
    login(client, monkeypatch)
    accepted = client.post("/api/runs/" + first.id + "/review", json={"decision": "accept"})
    assert accepted.status_code == 200 and accepted.json()["status"] == "accepted"
    rejected = client.post("/api/runs/" + second.id + "/review", json={"decision": "reject"})
    assert rejected.json()["status"] == "rejected"
    # Decided once, and a run with no change has nothing to accept.
    again = client.post("/api/runs/" + first.id + "/review", json={"decision": "reject"})
    assert again.status_code == 409
    nothing = client.post("/api/runs/" + empty.id + "/review", json={"decision": "accept"})
    assert nothing.status_code == 409
    event = next(e for e in all_items(Event, run_id=first.id) if e.kind == "reviewed")
    assert event.data["decision"] == "accept" and event.data["tests_passed"] is False


def test_pr_needs_a_finished_or_accepted_run_not_passing_tests(
    client, monkeypatch, tmp_path
):
    import workbench.app as routes

    login(client, monkeypatch)
    repo = local_repo(tmp_path)
    pulls = []

    async def fake_github(path, token="", method="GET", payload=None):
        if path.endswith("/pulls"):
            pulls.append(payload)
            return {"html_url": "https://github.com/owner/demo/pull/1"}
        return {"permissions": {"push": True}}

    async def fake_git(*args, **kwargs):
        return "abc"

    monkeypatch.setattr(routes, "github", fake_github)
    monkeypatch.setattr(routes, "git", fake_git)

    def make(**over):
        return stored_run(repo, path=str(tmp_path), commit_sha="abc", **over)

    # Waiting for review (a limit was reached): no PR until a person accepts.
    waiting = make()
    assert client.post("/api/runs/" + waiting.id + "/pr").status_code == 409
    client.post("/api/runs/" + waiting.id + "/review", json={"decision": "accept"})
    assert client.post("/api/runs/" + waiting.id + "/pr").status_code == 200
    # A finished run opens a PR even though its tests failed; the PR says so.
    finished = make()
    finished.status = "completed"
    save(finished)
    assert client.post("/api/runs/" + finished.id + "/pr").status_code == 200
    # The PR carries the change, not the test run.
    assert all(
        "Tests" not in body["body"] and "1 failed" not in body["body"]
        for body in pulls
    )
    # A rejected run can never become a PR.
    other = make()
    client.post("/api/runs/" + other.id + "/review", json={"decision": "reject"})
    assert client.post("/api/runs/" + other.id + "/pr").status_code == 409
    assert get(Run, other.id).pr_url == ""


def test_failing_tests_are_reported_but_do_not_stop_a_run_finishing(
    client, monkeypatch, tmp_path
):
    source = tmp_path / "src"
    git_repo(
        source,
        {"a.py": "x = 1\n", "tests/test_a.py": "def test_a():\n    assert False\n"},
    )
    asked = []

    async def chat(messages, *args, **kwargs):
        asked.append(1)
        return (
            SimpleNamespace(
                content="任务完成",
                tool_calls=[],
                model_dump=lambda exclude_none=True: {"role": "assistant"},
            ),
            10,
        )

    async def codegraph(*args, **kwargs):
        return {"exit_code": 0, "output": "", "stdout": ""}

    monkeypatch.setattr(agent, "chat", chat)
    monkeypatch.setattr(agent, "codegraph", codegraph)
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
                "max_steps": 10,
                "max_tokens": 100000,
            },
        )
    )
    asyncio.run(agent.run_agent(run.id))
    done = get(Run, run.id)
    # The model is not sent back over the failure, and the result is kept.
    assert len(asked) == 1
    assert done.status == "completed", done.error
    assert done.tests["exit_code"] != 0 and "failed" in done.tests["output"]


def say(text, calls=()):
    return (
        SimpleNamespace(
            content=text,
            tool_calls=list(calls),
            model_dump=lambda exclude_none=True: {"role": "assistant"},
        ),
        10,
    )


def test_a_follow_up_continues_the_conversation_in_the_same_worktree(
    client, monkeypatch, tmp_path
):
    source = tmp_path / "src"
    git_repo(source, {"a.py": "x = 1\n"})
    call = SimpleNamespace(
        id="c1",
        function=SimpleNamespace(name="list_files", arguments="{}"),
        model_dump=lambda: {
            "id": "c1",
            "type": "function",
            "function": {"name": "list_files", "arguments": "{}"},
        },
    )
    replies = [say("", [call]), say("第一轮完成"), say("第二轮完成")]
    sent = []

    async def chat(messages, *args, **kwargs):
        sent.append(list(messages))
        return replies.pop(0)

    async def codegraph(*args, **kwargs):
        return {"exit_code": 0, "output": "", "stdout": ""}

    monkeypatch.setattr(agent, "chat", chat)
    monkeypatch.setattr(agent, "codegraph", codegraph)
    repo = save(Repository(name="local", path=str(source), source="local", status="ready"))
    run = save(
        Run(
            repo_id=repo.id,
            actor="maintainer",
            task={"id": "T", "title": "fix"},
            config={
                "preset": "auto",
                "tools": {},
                "directory": str(tmp_path / "work"),
                "max_steps": 10,
                "max_tokens": 100000,
            },
        )
    )
    asyncio.run(agent.run_agent(run.id))
    first = get(Run, run.id)
    assert first.status == "completed", first.error
    asyncio.run(agent.run_agent(run.id, "再检查一下"))
    second = get(Run, run.id)
    assert second.status == "completed" and second.path == first.path
    # The second turn sees the whole first turn, tool results included.
    roles = [m["role"] for m in sent[-1]]
    assert roles == ["system", "user", "assistant", "tool", "assistant", "user"]
    assert sent[-1][2]["tool_calls"][0]["id"] == sent[-1][3]["tool_call_id"] == "c1"
    assert sent[-1][-1]["content"] == "再检查一下"
    events = all_items(Event, run_id=run.id)
    assert [e.data["text"] for e in events if e.kind == "user_message"] == ["再检查一下"]


def test_follow_up_endpoint_only_continues_a_finished_run_without_a_pr(
    client, monkeypatch, tmp_path
):
    import workbench.app as routes

    login(client, monkeypatch)
    repo = local_repo(tmp_path)
    started = []

    def launch(coroutine):
        started.append(coroutine)
        coroutine.close()
        return SimpleNamespace()

    monkeypatch.setattr(routes, "launch", launch)

    def post(run):
        return client.post("/api/runs/" + run.id + "/messages", json={"text": "继续"})

    finished = stored_run(repo, path=str(tmp_path))
    finished.status = "completed"
    save(finished)
    assert post(finished).status_code == 200 and len(started) == 1
    assert get(Run, finished.id).status == "running"
    # It is running now, so a second message is refused.
    routes.jobs.pop(finished.id, None)
    assert post(finished).status_code == 409
    done = stored_run(repo, path=str(tmp_path), pr_url="https://github.com/o/r/pull/1")
    done.status = "completed"
    save(done)
    assert post(done).status_code == 409
    rejected = stored_run(repo, path=str(tmp_path))
    rejected.status = "rejected"
    save(rejected)
    assert post(rejected).status_code == 409


def test_pr_commit_uses_the_login_as_author_with_real_git(client, monkeypatch, tmp_path):
    import subprocess

    import workbench.app as routes

    login(client, monkeypatch, "JiaMingWang-CN")
    work = tmp_path / "work"
    git_repo(work, {"a.py": "x = 1\n"})
    (work / "a.py").write_text("x = 2\n", encoding="utf-8")
    repo = local_repo(tmp_path)
    run = stored_run(repo, path=str(work))
    run.status = "completed"
    save(run)

    async def fake_github(path, token="", method="GET", payload=None):
        if path.endswith("/pulls"):
            return {"html_url": "https://github.com/owner/demo/pull/1"}
        return {"permissions": {"push": True}}

    real_git = routes.git

    async def git(*args, **kwargs):
        if args and args[0] == "push":
            return ""
        return await real_git(*args, **kwargs)

    async def token(request):
        return "t"

    monkeypatch.setattr(routes, "github", fake_github)
    monkeypatch.setattr(routes, "github_token", token)
    monkeypatch.setattr(routes, "git", git)
    response = client.post("/api/runs/" + run.id + "/pr")
    assert response.status_code == 200, response.text
    author = subprocess.run(
        ["git", "-C", str(work), "log", "-1", "--format=%an <%ae>"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert author == "JiaMingWang-CN <JiaMingWang-CN@users.noreply.github.com>"
