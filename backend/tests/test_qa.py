import asyncio
import json
from types import SimpleNamespace

import pytest
from helpers import login

from workbench import qa
from workbench.db import Repository, index_issues, save


def reply(content="", calls=()):
    tool_calls = [
        SimpleNamespace(
            id=f"c{i}",
            function=SimpleNamespace(name=name, arguments=json.dumps(args)),
            model_dump=lambda i=i: {"id": f"c{i}"},
        )
        for i, (name, args) in enumerate(calls)
    ]
    return (
        SimpleNamespace(
            content=content,
            tool_calls=tool_calls or None,
            model_dump=lambda exclude_none=True: {"role": "assistant"},
        ),
        7,
    )


ISSUES = [
    {
        "number": 3,
        "title": "搜索笔记时报错",
        "body": "SQLite 参数错误，单引号",
        "state": "open",
        "labels": ["bug"],
        "html_url": "https://github.com/o/r/issues/3",
        "comments_text": "位置 search_notes",
    },
    {
        "number": 4,
        "title": "无关",
        "body": "文档",
        "state": "closed",
        "labels": [],
        "html_url": "https://github.com/o/r/issues/4",
        "comments_text": "",
    },
]


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "search.py").write_text(
        "def search_notes(q):\n    return q\n", encoding="utf-8"
    )
    (tmp_path / ".env").write_text("SECRET=1", encoding="utf-8")
    saved = save(
        Repository(
            name="o/r",
            path=str(tmp_path),
            source="local",
            status="ready",
            issues=ISSUES,
        )
    )
    index_issues(saved)
    return saved


def script(monkeypatch, replies, seen):
    queue = list(replies)

    async def chat(
        messages, tools=None, actor="", max_tokens=0, structured=False, purpose=""
    ):
        seen.append({"messages": list(messages), "tools": tools})
        return queue.pop(0) if queue else reply("兜底回答")

    async def codegraph(mode, query="", path="", json_output=False):
        return {
            "exit_code": 0,
            "output": f"[{mode}] {query}\n  app/search.py:1\n  app/routes.py:20",
        }

    monkeypatch.setattr(qa, "chat", chat)
    monkeypatch.setattr(qa, "codegraph", codegraph)


def test_agent_investigates_with_tools_then_answers_with_citations(
    client, repo, monkeypatch
):
    seen = []
    script(
        monkeypatch,
        [
            reply(calls=[("search_issues", {"query": "搜索"})]),
            reply(
                calls=[
                    ("search_code", {"query": "search_notes"}),
                    ("read_file", {"path": "app/search.py"}),
                ]
            ),
            reply("`search_notes` 在 app/search.py:1 被 Issue #3 报告出错。"),
        ],
        seen,
    )
    result = asyncio.run(qa.answer_question(repo, "搜索为什么报错", "maintainer"))
    assert "Issue #3" in result["answer"]
    assert [s["tool"] for s in result["steps"]] == [
        "search_issues",
        "search_code",
        "read_file",
    ]
    # The tool outputs were fed back to the model before it answered.
    fed_back = [m for m in seen[-1]["messages"] if m.get("role") == "tool"]
    assert len(fed_back) == 3 and "搜索笔记时报错" in fed_back[0]["content"]
    assert "def search_notes" in fed_back[2]["content"]
    # Only references actually used in the answer are returned.
    assert any(
        s["type"] == "issue" and s["number"] == 3 and s["url"].endswith("/3")
        for s in result["sources"]
    )
    assert not any(s.get("number") == 4 for s in result["sources"])
    assert any(s["type"] == "code" and s["file"] == "app/search.py" for s in result["sources"])
    assert not any(s.get("file") == "app/routes.py" for s in result["sources"])
    assert result["tokens"] == 21


def test_agent_gets_tools_and_must_not_answer_without_context(client, repo, monkeypatch):
    seen = []
    script(monkeypatch, [reply("直接回答")], seen)
    asyncio.run(qa.answer_question(repo, "介绍项目", "maintainer"))
    names = {t["function"]["name"] for t in seen[0]["tools"]}
    assert {"search_code", "find_symbol", "search_issues", "get_issue", "read_file", "list_files"} <= names
    assert "工具" in seen[0]["messages"][0]["content"]


def test_step_limit_forces_a_final_tool_free_answer(client, repo, monkeypatch):
    seen = []
    script(
        monkeypatch,
        [reply(calls=[("list_files", {})]) for _ in range(qa.MAX_STEPS)]
        + [reply("基于已收集信息的总结")],
        seen,
    )
    result = asyncio.run(qa.answer_question(repo, "介绍项目", "maintainer"))
    assert result["answer"] == "基于已收集信息的总结"
    assert len(result["steps"]) == qa.MAX_STEPS
    assert seen[-1]["tools"] is None


def test_file_tools_stay_inside_the_repository(repo):
    sources = []
    for path in ("../outside.txt", ".env", ".git/config", "/etc/passwd"):
        with pytest.raises(ValueError):
            asyncio.run(qa.run_tool(repo, "read_file", {"path": path}, sources))
    text = asyncio.run(
        qa.run_tool(repo, "read_file", {"path": "app/search.py", "start": 1, "end": 1}, sources)
    )
    assert text.startswith("1\t") and "search_notes" in text
    listing = asyncio.run(qa.run_tool(repo, "list_files", {}, sources))
    assert "app/search.py" in listing and ".env" not in listing


def test_tool_errors_are_reported_to_the_model_not_raised(client, repo, monkeypatch):
    seen = []
    script(
        monkeypatch,
        [reply(calls=[("read_file", {"path": "../x"})]), reply("无法读取该文件")],
        seen,
    )
    result = asyncio.run(qa.answer_question(repo, "读取外部文件", "maintainer"))
    assert result["steps"][0]["error"] is True
    assert result["answer"] == "无法读取该文件"


def test_option_like_queries_are_not_passed_to_codegraph(repo):
    with pytest.raises(ValueError):
        asyncio.run(qa.run_tool(repo, "search_code", {"query": "--help"}, []))


def test_ask_endpoint_returns_answer_steps_and_sources(client, repo, monkeypatch):
    import workbench.app as routes

    login(client, monkeypatch)

    async def fake(repository, prompt, actor):
        assert repository.id == repo.id and prompt == "问题"
        return {"answer": "答案", "steps": [], "sources": [], "tokens": 1}

    monkeypatch.setattr(routes, "answer_question", fake)
    response = client.post("/api/repos/" + repo.id + "/ask", json={"prompt": "问题"})
    assert response.status_code == 200
    assert response.json()["answer"] == "答案"


def test_multi_word_chinese_queries_match_each_word(client, repo):
    from workbench.db import find_issues

    assert [i["number"] for i in find_issues(repo, "搜索笔记 报错")] == [3]
    assert [i["number"] for i in find_issues(repo, "搜索 完全无关的词")] == [3]
    assert find_issues(repo, "完全无关的词") == []
