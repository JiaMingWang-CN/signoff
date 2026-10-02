from workbench.config import settings


def guest_actor(client):
    import base64
    import json

    client.get("/api/auth/me")
    data = client.cookies.get("session").split(".")[0]
    return "guest:" + json.loads(base64.b64decode(data))["guest_id"]


def login(client, monkeypatch, name="maintainer"):
    from urllib.parse import parse_qs, urlparse

    import workbench.app as routes

    async def exchange(payload):
        return {"access_token": "t-" + name, "expires_in": 3600, "refresh_token": "r"}

    async def profile(*args):
        return {"login": name, "avatar_url": "a", "html_url": "h"}

    monkeypatch.setattr(routes, "oauth_token", exchange)
    monkeypatch.setattr(routes, "github", profile)
    monkeypatch.setattr(settings, "github_client_id", "id")
    monkeypatch.setattr(settings, "github_client_secret", "secret")
    response = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(response.headers["location"]).query)["state"][0]
    return client.get(
        "/api/auth/github/callback",
        params={"code": "c", "state": state},
        follow_redirects=False,
    )
