import asyncio

import pytest

import workbench.services as services


@pytest.fixture(autouse=True)
def fresh_cache():
    services.codegraph_check_cache.clear()
    yield
    services.codegraph_check_cache.clear()


def fake_cli(monkeypatch, version="1.6.0", missing=False, calls=None):
    def resolve(name):
        if missing:
            raise RuntimeError("未安装工具：codegraph")
        return ["codegraph"]

    async def run(args, *rest, **kwargs):
        if calls is not None:
            calls.append(args)
        return {"exit_code": 0, "stdout": version + "\n", "stderr": "", "output": ""}

    monkeypatch.setattr(services, "resolve_executable", resolve)
    monkeypatch.setattr(services, "command", run)


def test_available_and_verified(monkeypatch):
    fake_cli(monkeypatch)
    status = asyncio.run(services.codegraph_status())
    assert status == {
        "available": True,
        "version": "1.6.0",
        "verified_version": services.VERIFIED_CODEGRAPH,
        "compatible": True,
        "hint": "",
    }


def test_missing_cli_reports_install_command(monkeypatch):
    fake_cli(monkeypatch, missing=True)
    status = asyncio.run(services.codegraph_status())
    assert status["available"] is False and status["compatible"] is False
    assert "npm i -g @colbymchenry/codegraph" in status["hint"]


def test_other_minor_version_is_flagged_but_usable(monkeypatch):
    fake_cli(monkeypatch, version="1.7.2")
    status = asyncio.run(services.codegraph_status())
    assert status["available"] and not status["compatible"]
    assert services.VERIFIED_CODEGRAPH in status["hint"]


def test_result_is_cached_briefly(monkeypatch):
    calls = []
    fake_cli(monkeypatch, calls=calls)
    asyncio.run(services.codegraph_status())
    asyncio.run(services.codegraph_status())
    assert len(calls) == 1


def test_health_endpoint_reports_codegraph_and_stays_ok(client, monkeypatch):
    fake_cli(monkeypatch, missing=True)
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["codegraph"]["available"] is False


def test_import_fails_fast_with_install_hint_when_cli_is_missing(client, monkeypatch):
    from helpers import login

    login(client, monkeypatch)
    fake_cli(monkeypatch, missing=True)
    response = client.post("/api/repos/import", json={"name": "owner/never-imported"})
    assert response.status_code == 503
    assert "npm i -g @colbymchenry/codegraph" in response.json()["detail"]
