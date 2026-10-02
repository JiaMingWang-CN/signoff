import asyncio
from types import SimpleNamespace

import pytest
from helpers import login

import workbench.services as services
from workbench.db import Preference, upsert

BODY = {"llm_base_url": "https://x/v1", "llm_model": "m", "workspace_dir": "."}


@pytest.fixture(autouse=True)
def fresh_preferences(client):
    # The test database is shared, so start from no saved settings.
    upsert(Preference(values={}))


def test_each_part_keeps_its_own_effort_and_unset_parts_stay_default(
    client, monkeypatch
):
    login(client, monkeypatch)
    assert client.get("/api/settings").json()["reasoning_effort"] == {}
    efforts = {"review": "low", "plan": "xhigh", "agent": "max"}
    saved = client.put("/api/settings", json={**BODY, "reasoning_effort": efforts})
    assert saved.status_code == 200 and saved.json()["reasoning_effort"] == efforts
    assert services.reasoning_effort("review") == "low"
    assert services.reasoning_effort("plan") == "xhigh"
    assert services.reasoning_effort("ask") == ""
    # Saving again without the field clears it rather than keeping stale values.
    cleared = client.put("/api/settings", json=BODY)
    assert cleared.json()["reasoning_effort"] == {}


def test_unknown_parts_and_levels_are_rejected(client, monkeypatch):
    login(client, monkeypatch)
    for bad in ({"review": "extreme"}, {"chat": "low"}):
        response = client.put("/api/settings", json={**BODY, "reasoning_effort": bad})
        assert response.status_code == 422


def test_chat_sends_the_effort_of_its_own_part_only(client, monkeypatch):
    login(client, monkeypatch)
    client.put(
        "/api/settings", json={**BODY, "reasoning_effort": {"review": "high"}}
    )
    sent = []

    class Completions:
        async def create(self, **kwargs):
            sent.append(kwargs)
            return SimpleNamespace(
                usage=None,
                choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
            )

    class Client:
        chat = SimpleNamespace(completions=Completions())

        async def close(self):
            pass

    monkeypatch.setattr(services, "llm_client", lambda: (Client(), "m"))
    for purpose in ("review", "ask", ""):
        asyncio.run(services.chat([{"role": "user", "content": "hi"}], purpose=purpose))
    assert sent[0]["extra_body"] == {"reasoning_effort": "high"}
    assert "extra_body" not in sent[1] and "extra_body" not in sent[2]
    # A per-call effort beats the setting; an unknown one falls back to it.
    asyncio.run(services.chat([{"role": "user", "content": "hi"}], purpose="review", effort="max"))
    asyncio.run(services.chat([{"role": "user", "content": "hi"}], purpose="review", effort="turbo"))
    assert sent[3]["extra_body"] == {"reasoning_effort": "max"}
    assert sent[4]["extra_body"] == {"reasoning_effort": "high"}


def test_api_key_is_saved_encrypted_kept_when_blank_and_never_returned(
    client, monkeypatch
):
    from workbench.config import safe_error
    from workbench.db import get

    login(client, monkeypatch)
    assert client.get("/api/settings").json()["llm_configured"] is False
    secret = "key-for-this-test-0123456789"  # gitleaks:allow
    saved = client.put("/api/settings", json={**BODY, "llm_api_key": secret})
    assert saved.status_code == 200 and saved.json()["llm_configured"] is True
    assert secret not in saved.text and secret not in client.get("/api/settings").text
    # Stored encrypted, not as typed.
    stored = get(Preference, "settings").values
    assert secret not in str(stored) and services.llm_api_key() == secret
    # A later save with the field left blank keeps the key; a new value replaces it.
    client.put("/api/settings", json={**BODY, "llm_model": "m2"})
    assert services.llm_api_key() == secret
    client.put("/api/settings", json={**BODY, "llm_api_key": "another-key-9876543210"})
    assert services.llm_api_key() == "another-key-9876543210"
    # Errors that echo the key do not leak it.
    assert "another-key-9876543210" not in safe_error("401 for another-key-9876543210")


def test_model_calls_need_the_key_and_model_from_settings(client, monkeypatch):
    from fastapi import HTTPException

    login(client, monkeypatch)
    client.put("/api/settings", json={**BODY, "llm_model": ""})
    with pytest.raises(HTTPException) as missing_key:
        services.llm_client()
    assert missing_key.value.status_code == 503 and "API Key" in missing_key.value.detail
    client.put(
        "/api/settings",
        json={**BODY, "llm_model": "", "llm_api_key": "k-0123456789abcdef"},  # gitleaks:allow
    )
    with pytest.raises(HTTPException) as missing_model:
        services.llm_client()
    assert "模型" in missing_model.value.detail
    client.put(
        "/api/settings",
        json={**BODY, "llm_model": "m", "llm_base_url": "https://llm.example/v1"},
    )
    http, model = services.llm_client()
    assert model == "m" and str(http.base_url).startswith("https://llm.example/v1")
