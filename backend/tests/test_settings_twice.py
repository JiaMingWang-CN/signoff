from helpers import login


def test_settings_can_be_saved_more_than_once(client, monkeypatch):
    login(client, monkeypatch)
    body = {"llm_base_url": "https://x/v1", "llm_model": "m1", "workspace_dir": "."}
    assert client.put("/api/settings", json=body).status_code == 200
    second = client.put("/api/settings", json={**body, "llm_model": "m2"})
    assert second.status_code == 200 and second.json()["llm_model"] == "m2"
