import pytest
from fastapi import HTTPException
from helpers import login

import workbench.app as routes
from workbench.config import settings
from workbench.db import Repository, all_items


@pytest.mark.parametrize("missing", ["github_client_id", "github_client_secret"])
def test_unconfigured_login_redirects_to_notice(client, monkeypatch, missing):
    monkeypatch.setattr(settings, "github_client_id", "configured-id")
    monkeypatch.setattr(settings, "github_client_secret", "configured-secret")
    monkeypatch.setattr(settings, missing, "")
    response = client.get("/api/auth/github/login", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == settings.public_url + "/repos?notice=entry-unavailable"
    assert "ALLOWED_GITHUB_USERS" not in response.text


@pytest.mark.parametrize("status", [401, 403])
def test_guest_demo_credentials_failure_is_an_unavailable_notice(client, monkeypatch, status):
    monkeypatch.setattr(settings, "demo_repo", "audit-demo/unavailable-entry")

    async def unavailable(*args):
        raise HTTPException(status, "GitHub: Bad credentials")

    async def ready():
        return {"available": True}

    monkeypatch.setattr(routes, "github", unavailable)
    monkeypatch.setattr(routes, "codegraph_status", ready)
    for response in (client.get("/api/github/repos"), client.post("/api/repos/import", json={})):
        assert response.status_code == 503
        assert response.json() == {"detail": "暂未开放入口"}
    assert not any(r.name == settings.demo_repo for r in all_items(Repository))


def test_signed_in_repository_errors_are_not_hidden(client, monkeypatch):
    login(client, monkeypatch)

    async def unavailable(*args):
        raise HTTPException(401, "GitHub: Bad credentials")

    async def ready():
        return {"available": True}

    monkeypatch.setattr(routes, "github", unavailable)
    monkeypatch.setattr(routes, "codegraph_status", ready)
    response = client.post("/api/repos/import", json={"name": "audit-owner/private"})
    assert response.status_code == 401
    assert response.json()["detail"] == "GitHub: Bad credentials"
