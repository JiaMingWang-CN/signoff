import asyncio
import os
import shutil
import sys
from pathlib import Path

import pytest
from helpers import guest_actor, login

import workbench.app as routes
from workbench import console
from workbench.agent import RunConfig, target_path
from workbench.config import ROOT, settings
from workbench.db import Conversation, Plan, Repository, Run, Scan, get, save
from workbench.sandbox import sandbox_command
from workbench.services import command


def test_logged_out_cookie_cannot_be_replayed(client, monkeypatch):
    login(client, monkeypatch)
    cookie = client.cookies.get("session")
    assert client.get("/api/audit").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/audit", headers={"Cookie": "session=" + cookie}).status_code == 401
    response = client.get("/api/settings", headers={"Cookie": "session=" + cookie})
    assert "llm_base_url" not in response.json()


def test_removed_allowlist_user_loses_existing_session(client, monkeypatch):
    login(client, monkeypatch)
    monkeypatch.setattr(settings, "allowed_github_users", "another-user")
    assert client.get("/api/audit").status_code == 401


def test_same_ip_guests_cannot_read_or_delete_each_others_data(client, tmp_path):
    first = guest_actor(client)
    first_cookie = client.cookies.get("session")
    repo = save(Repository(name=settings.demo_repo, path=str(tmp_path), status="ready"))
    plan = save(Plan(repo_id=repo.id, actor=first))
    scan = save(Scan(repo_id=repo.id, actor=first, status="complete"))
    run = save(Run(repo_id=repo.id, actor=first))
    convo = save(Conversation(actor=first))
    client.cookies.clear()
    assert guest_actor(client) != first
    assert client.get(f"/api/repos/{repo.id}/plans").json() == []
    assert client.get(f"/api/repos/{repo.id}/scans").json() == []
    assert client.get(f"/api/runs/{run.id}").status_code == 404
    assert client.get(f"/api/console/conversations/{convo.id}").status_code == 404
    assert client.post(f"/api/plans/{plan.id}/apply").status_code == 404
    assert client.post(f"/api/scans/{scan.id}/review/pause").status_code == 404
    assert client.delete(f"/api/repos/{repo.id}/plans").json() == {"deleted": 0}
    assert get(Plan, plan.id)
    assert client.delete(f"/api/repos/{repo.id}/plans", headers={"Cookie": "session=" + first_cookie}).json() == {"deleted": 1}


def test_new_guest_cookie_does_not_reset_ip_message_limit(client, monkeypatch):
    monkeypatch.setattr(routes, "client_address", lambda request: "203.0.113.88")
    monkeypatch.setattr(settings, "guest_daily_console_messages", 1)
    monkeypatch.setattr(console, "start", lambda convo, request: save(convo))
    assert client.post("/api/console/messages", json={"text": "first"}).status_code == 200
    client.cookies.clear()
    assert client.post("/api/console/messages", json={"text": "second"}).status_code == 429


def test_guest_conversation_cap_survives_cookie_reset(client, monkeypatch):
    monkeypatch.setattr(routes, "client_address", lambda request: "203.0.113.89")
    monkeypatch.setattr(settings, "guest_max_conversations", 1)
    monkeypatch.setattr(console, "start", lambda convo, request: save(convo))
    assert client.post("/api/console/messages", json={"text": "first"}).status_code == 200
    client.cookies.clear()
    assert client.post("/api/console/messages", json={"text": "second"}).status_code == 429


def test_full_permission_file_tools_stay_inside_worktree(tmp_path):
    repo = save(Repository(name="o/security", path=str(tmp_path), status="ready"))
    run = Run(repo_id=repo.id, path=str(tmp_path), config=RunConfig(preset="full").model_dump())
    with pytest.raises(ValueError, match="路径超出"):
        target_path(run, "../outside")


def test_public_commands_fail_closed_without_sandbox(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "public_url", "https://www.signoff.top")
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="bubblewrap"):
        sandbox_command(["python", "-V"], tmp_path)


def test_guest_budget_includes_input_without_calling_model(monkeypatch):
    from fastapi import HTTPException
    from workbench import services

    monkeypatch.setattr(settings, "guest_daily_llm_tokens", 2000)
    monkeypatch.setattr(services, "llm_client", lambda: pytest.fail("Model must not be called"))
    with pytest.raises(HTTPException) as error:
        asyncio.run(services.chat([{"role": "user", "content": "x" * 3000}], actor="guest:budget-audit", max_tokens=100))
    assert error.value.status_code == 429
    assert not services.guest_llm_lock.locked()


@pytest.mark.skipif(os.name != "posix" or not shutil.which("bwrap"), reason="Linux bubblewrap required")
def test_sandbox_hides_secrets_and_protects_runtime(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "agent_sandbox", True)
    work = tmp_path / "work"
    work.mkdir()
    sentinel = tmp_path / "outside-secret"
    sentinel.write_text("private", encoding="utf-8")
    marker = Path(sys.prefix) / "sandbox-write-must-fail"
    script = (
        "import os,pathlib; "
        f"assert not pathlib.Path({str(sentinel)!r}).exists(); "
        f"assert not pathlib.Path({str(ROOT / '.env')!r}).exists(); "
        "assert not os.getenv('APP_SECRET'); "
        "pathlib.Path('allowed.txt').write_text('ok'); "
        f"pathlib.Path({str(marker)!r}).write_text('blocked')"
    )
    result = asyncio.run(command(sandbox_command([sys.executable, "-c", script], work), work))
    assert result["exit_code"] != 0
    assert "Read-only file system" in result["output"]
    assert (work / "allowed.txt").read_text() == "ok"
    assert not marker.exists()
