import json
import time
from types import SimpleNamespace

import pytest
from helpers import login

import workbench.app as routes
from workbench import console
from workbench.db import Repository, Scan, all_items, get, index_issues, save


def reply(content="", calls=()):
    tool_calls = [
        {"id": f"c{i}-{name}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
        for i, (name, args) in enumerate(calls)
    ]
    data = {"role": "assistant", "content": content, **({"tool_calls": tool_calls} if tool_calls else {})}
    return (
        SimpleNamespace(
            content=content,
            tool_calls=tool_calls or None,
            model_dump=lambda exclude_none=True: data,
        ),
        5,
    )


@pytest.fixture
def scripted(monkeypatch):
    queue, seen = [], []

    async def chat(messages, tools=None, actor="", max_tokens=0, structured=False, purpose="", effort=""):
        seen.append({"messages": list(messages), "tools": tools, "effort": effort})
        return queue.pop(0) if queue else reply("完成")

    async def no_scan(*args):
        return None

    monkeypatch.setattr(console, "chat", chat)
    monkeypatch.setattr(routes, "scan_repository", no_scan)
    return queue, seen


@pytest.fixture
def repo(tmp_path):
    return save(Repository(name="o/console", path=str(tmp_path), source="local", status="ready"))


def wait(client, identity):
    for _ in range(200):
        convo = client.get("/api/console/conversations/" + identity).json()
        if convo["status"] != "running":
            return convo
        time.sleep(0.02)
    raise AssertionError("回复未结束")


def send(client, repo, text, permission, **extra):
    response = client.post(
        "/api/console/messages",
        json={"text": text, "permission": permission, "repo_id": repo.id, **extra},
    )
    assert response.status_code == 200, response.text
    return wait(client, response.json()["id"])


def tool_results(convo):
    return [m["content"] for m in convo["messages"] if m["role"] == "tool"]


def test_every_tool_is_exposed_with_a_kind(client):
    tools = client.get("/api/console/tools").json()
    names = {t["name"] for t in tools}
    assert {"list_repos", "search_code", "start_scan", "draft_plan", "start_agent_run", "create_pr", "update_settings"} <= names
    assert {t["kind"] for t in tools} == {"read", "write"}


def test_readonly_refuses_operations_but_answers_queries(client, monkeypatch, scripted, repo):
    login(client, monkeypatch)
    queue, seen = scripted
    queue += [reply(calls=[("list_repos", {}), ("start_scan", {})]), reply("已列出仓库，扫描需要更高权限")]
    convo = send(client, repo, "列出仓库并扫描", "readonly")
    first, second = tool_results(convo)
    assert "o/console" in first
    assert second.startswith("错误：当前为只读权限")
    assert not all_items(Scan, repo_id=repo.id)
    assert convo["messages"][-1]["content"] == "已列出仓库，扫描需要更高权限"
    assert "只读" in seen[0]["messages"][0]["content"]
    assert repo.id in seen[0]["messages"][0]["content"]


def test_approve_waits_for_the_user_then_runs_the_operation(client, monkeypatch, scripted, repo):
    login(client, monkeypatch)
    queue, _ = scripted
    queue += [reply(calls=[("start_scan", {})]), reply("扫描已开始")]
    convo = send(client, repo, "扫描一下", "approve")
    assert convo["status"] == "waiting"
    assert convo["pending"]["tool"] == "start_scan"
    assert not all_items(Scan, repo_id=repo.id)

    response = client.post(f"/api/console/conversations/{convo['id']}/decision", json={"decision": "approve"})
    assert response.status_code == 200
    convo = wait(client, convo["id"])
    assert convo["status"] == "idle" and not convo["pending"]
    assert len(all_items(Scan, repo_id=repo.id)) == 1
    assert convo["messages"][-1]["content"] == "扫描已开始"


def test_rejecting_tells_the_model_and_always_skips_later_approvals(client, monkeypatch, scripted, repo):
    login(client, monkeypatch)
    queue, _ = scripted
    queue += [reply(calls=[("start_scan", {})]), reply("好的，不扫描")]
    convo = send(client, repo, "扫描", "approve")
    client.post(f"/api/console/conversations/{convo['id']}/decision", json={"decision": "reject"})
    convo = wait(client, convo["id"])
    assert tool_results(convo) == ["用户拒绝了这个操作。"]
    assert not all_items(Scan, repo_id=repo.id)

    queue += [reply(calls=[("clear_plans", {})]), reply(calls=[("clear_plans", {})]), reply("已清空")]
    convo = send(client, repo, "清空规划", "approve", conversation_id=convo["id"])
    client.post(f"/api/console/conversations/{convo['id']}/decision", json={"decision": "always"})
    convo = wait(client, convo["id"])
    # The second call of the same tool ran without asking again.
    assert convo["status"] == "idle"
    assert tool_results(convo)[-2:] == ['{"deleted": 0}', '{"deleted": 0}']


def test_a_new_message_declines_the_waiting_operation(client, monkeypatch, scripted, repo):
    login(client, monkeypatch)
    queue, _ = scripted
    queue += [reply(calls=[("start_scan", {})])]
    convo = send(client, repo, "扫描", "approve")
    convo = send(client, repo, "算了，先看看仓库", "approve", conversation_id=convo["id"])
    assert "用户没有批准" in tool_results(convo)[0]
    assert not all_items(Scan, repo_id=repo.id)


def test_full_permission_runs_directly_and_needs_login_and_confirmation(client, monkeypatch, scripted, repo):
    queue, _ = scripted
    payload = {"text": "扫描", "permission": "full", "full_confirmed": True, "repo_id": repo.id}
    assert client.post("/api/console/messages", json=payload).status_code == 401
    login(client, monkeypatch)
    assert client.post("/api/console/messages", json={**payload, "full_confirmed": False}).status_code == 422
    queue += [reply(calls=[("start_scan", {})]), reply("开始了")]
    convo = send(client, repo, "扫描", "full", full_confirmed=True)
    assert convo["status"] == "idle"
    assert len(all_items(Scan, repo_id=repo.id)) == 1


def test_tools_keep_the_page_permission_checks(client, scripted, repo):
    # A guest cannot see a local repository, through the console either.
    queue, _ = scripted
    queue += [reply(calls=[("get_repo", {})]), reply("需要登录")]
    convo = send(client, repo, "看看仓库", "readonly")
    assert tool_results(convo)[0] == "错误：此仓库需要 GitHub 登录"


def test_conversations_belong_to_their_actor(client, monkeypatch, scripted, repo):
    convo = send(client, repo, "你好", "readonly")
    assert convo["id"] in [c["id"] for c in client.get("/api/console/conversations").json()]
    login(client, monkeypatch, "someone-else")
    assert client.get("/api/console/conversations/" + convo["id"]).status_code == 404
    assert client.get("/api/console/conversations").json() == []


def test_search_and_sync_reach_their_handlers_with_the_right_arguments(client, monkeypatch, scripted, repo):
    login(client, monkeypatch)
    queue, _ = scripted
    repo.issues = [{"number": 7, "title": "登录失败", "body": "token 过期", "state": "open", "labels": ["bug"], "html_url": "u"}]
    index_issues(save(repo))
    started = []

    async def sync(*args):
        started.append(args)

    monkeypatch.setattr(routes, "import_repository", sync)
    queue += [
        reply(calls=[("search_issues", {"query": "登录", "state": "open"}), ("sync_repo", {"mode": "full"})]),
        reply("好了"),
    ]
    convo = send(client, repo, "找登录相关 Issue 并全量同步", "full", full_confirmed=True)
    found, synced = tool_results(convo)
    assert json.loads(found)[0]["number"] == 7
    assert json.loads(synced)["id"] == repo.id
    assert started and started[0][3] == "full"
    assert get(Repository, repo.id).syncing


def test_the_chosen_effort_is_sent_with_every_model_call_of_the_conversation(client, monkeypatch, scripted, repo):
    login(client, monkeypatch)
    queue, seen = scripted
    queue += [reply(calls=[("list_repos", {})]), reply("好")]
    convo = send(client, repo, "列出仓库", "readonly", effort="xhigh")
    assert [call["effort"] for call in seen] == ["xhigh", "xhigh"]
    assert convo["effort"] == "xhigh"
    send(client, repo, "再来", "readonly", effort="", conversation_id=convo["id"])
    assert seen[-1]["effort"] == ""
    bad = client.post("/api/console/messages", json={"text": "x", "effort": "turbo"})
    assert bad.status_code == 422


@pytest.mark.parametrize("changes", [{"sync_mode": "full"}, {"llm_model": "updated-model"}])
def test_console_updates_settings_and_preserves_other_fields(client, monkeypatch, scripted, repo, changes):
    login(client, monkeypatch)
    before = client.get("/api/settings").json()
    queue, _ = scripted
    queue += [reply(calls=[("update_settings", {"changes": changes})]), reply("设置已更新")]
    convo = send(client, repo, "修改设置", "full", full_confirmed=True)
    result = json.loads(tool_results(convo)[0])
    after = client.get("/api/settings").json()
    for key in console.SETTING_KEYS:
        assert after[key] == changes.get(key, before[key])
        assert result[key] == after[key]
