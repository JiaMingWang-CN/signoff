import asyncio
import re
import time
from datetime import datetime, timezone

import pytest
from helpers import login
from sqlalchemy import create_engine, inspect, text

from workbench import sync
from workbench.config import settings
from workbench.db import Preference, Repository, Token, get, save, upsert


@pytest.fixture(autouse=True)
def clean_state(client):
    """The test database is shared; start each test without repositories or preferences."""
    from sqlmodel import Session, select

    from workbench.db import engine

    def wipe():
        with Session(engine) as session:
            for model in (Repository, Preference):
                for row in session.exec(select(model)).all():
                    session.delete(row)
            session.commit()

    wipe()
    yield
    wipe()


def upstream(number, state="open", updated="2026-09-10T00:00:00Z", comments=0, pr=False):
    issue = {
        "number": number,
        "title": f"Issue {number}",
        "body": f"body {number}",
        "state": state,
        "html_url": f"https://github.com/o/r/issues/{number}",
        "created_at": "2026-09-01T00:00:00Z",
        "updated_at": updated,
        "labels": [{"name": "bug"}],
        "comments": comments,
    }
    if pr:
        issue["pull_request"] = {}
    return issue


def stored(number, state="open", updated="2026-09-01T00:00:00Z", comments_text=""):
    return {
        "number": number,
        "title": f"Issue {number}",
        "body": f"body {number}",
        "state": state,
        "html_url": f"https://github.com/o/r/issues/{number}",
        "created_at": "2026-09-01T00:00:00Z",
        "updated_at": updated,
        "labels": ["bug"],
        "comments_text": comments_text,
    }


class FakeGitHub:
    def __init__(self, issues):
        self.issues = issues
        self.calls = []

    async def __call__(self, path, token="", method="GET", payload=None):
        self.calls.append(path)
        comment = re.search(r"/issues/(\d+)/comments", path)
        if comment:
            return [{"body": f"comment on {comment[1]}"}]
        page = int(re.search(r"[?&]page=(\d+)", path)[1])
        if page > 1:
            return []
        since = re.search(r"since=([^&]+)", path)
        return [i for i in self.issues if not since or i["updated_at"] >= since[1]]

    def issue_paths(self):
        return [c for c in self.calls if "/issues?" in c]

    def comment_paths(self):
        return [c for c in self.calls if "/comments" in c]


def repository(issues, synced="2026-09-05T00:00:00Z", **extra):
    return Repository(
        name="o/r", path=".", issues=issues, issues_synced=synced, **extra
    )


def run_sync(monkeypatch, repo, remote, mode):
    fake = FakeGitHub(remote)
    monkeypatch.setattr(sync, "github", fake)
    return asyncio.run(sync.sync_issues(repo, "token", mode)), fake


# ── incremental vs full ──────────────────────────────────────────────


def test_incremental_asks_only_for_changes_and_merges(monkeypatch):
    repo = repository([stored(1), stored(2)])
    remote = [
        upstream(1, updated="2026-09-01T00:00:00Z"),
        upstream(2, state="closed", comments=1),
        upstream(3, comments=1),
        upstream(4, pr=True, updated="2026-09-11T00:00:00Z"),
    ]
    result, fake = run_sync(monkeypatch, repo, remote, "incremental")
    assert "since=2026-09-05T00:00:00Z" in fake.issue_paths()[0]
    assert result["mode"] == "incremental" and not result["fell_back"]
    assert (result["added"], result["updated"], result["removed"]) == (1, 1, 0)
    by_number = {i["number"]: i for i in result["issues"]}
    assert sorted(by_number) == [1, 2, 3]  # the pull request is not an issue
    assert by_number[2]["state"] == "closed" and by_number[1]["state"] == "open"
    assert by_number[3]["comments_text"] == "comment on 3"
    # Comments are only fetched for the issues that came back.
    assert sorted(re.search(r"issues/(\d+)", c)[1] for c in fake.comment_paths()) == ["2", "3"]
    assert [i["number"] for i in result["issues"]] == [3, 2, 1]


def test_incremental_without_baseline_falls_back_to_full(monkeypatch):
    for repo in (repository([stored(1)], synced=""), repository([], synced="2026-09-05T00:00:00Z")):
        result, fake = run_sync(monkeypatch, repo, [upstream(1), upstream(2)], "incremental")
        assert "since=" not in fake.issue_paths()[0]
        assert result["mode"] == "full" and result["fell_back"] is True
        assert len(result["issues"]) == 2


def test_full_replaces_everything_and_reports_removed(monkeypatch):
    repo = repository([stored(1), stored(2), stored(9, comments_text="stale")])
    remote = [upstream(1, updated="2026-09-01T00:00:00Z"), upstream(2, updated="2026-09-20T00:00:00Z", comments=1), upstream(3)]
    result, fake = run_sync(monkeypatch, repo, remote, "full")
    assert "since=" not in fake.issue_paths()[0]
    assert result["mode"] == "full" and not result["fell_back"]
    assert (result["added"], result["updated"], result["removed"]) == (1, 1, 1)
    assert sorted(i["number"] for i in result["issues"]) == [1, 2, 3]  # #9 is gone


def test_baseline_is_the_time_the_sync_started(monkeypatch):
    before = datetime.now(timezone.utc).replace(microsecond=0)
    result, _ = run_sync(monkeypatch, repository([]), [upstream(1)], "full")
    started = datetime.strptime(result["started"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    assert before <= started <= datetime.now(timezone.utc)


def test_truncation_is_reported(monkeypatch):
    class Endless(FakeGitHub):
        async def __call__(self, path, token="", method="GET", payload=None):
            if "/comments" in path:
                return []
            number = int(re.search(r"[?&]page=(\d+)", path)[1])
            return [upstream(number * 1000 + i) for i in range(100)]

    monkeypatch.setattr(sync, "github", Endless([]))
    result = asyncio.run(sync.sync_issues(repository([], synced=""), "t", "full"))
    assert result["truncated"] is True and len(result["issues"]) == 1000


# ── when auto-sync is due ────────────────────────────────────────────

PREFS = {"auto_sync_enabled": True, "auto_sync_interval": 30}


def due(repo, prefs=PREFS, at=None):
    return sync.auto_sync_due(repo, prefs, at or time.time())


def ago(minutes):
    return datetime.fromtimestamp(time.time() - minutes * 60, timezone.utc).isoformat()


def test_auto_sync_due_rules():
    ready = {"status": "ready", "source": "github"}
    assert due(Repository(name="o/r", path=".", last_sync={"at": ago(31)}, **ready))
    assert not due(Repository(name="o/r", path=".", last_sync={"at": ago(5)}, **ready))
    # A failed attempt counts too, so a broken repo is not hammered.
    assert not due(Repository(name="o/r", path=".", last_sync={"at": ago(1), "error": "x"}, **ready))
    # Never synced: measured from when it was imported.
    assert due(Repository(name="o/r", path=".", updated=ago(40), **ready))
    assert not due(Repository(name="o/r", path=".", updated=ago(2), **ready))
    old = {"last_sync": {"at": ago(999)}}
    assert not due(Repository(name="o/r", path=".", status="ready", source="local", **old))
    assert not due(Repository(name="o/r", path=".", status="error", source="github", **old))
    assert not due(Repository(name="o/r", path=".", syncing=True, **ready, **old))
    assert not due(Repository(name="o/r", path=".", **ready, **old), {"auto_sync_enabled": False})
    assert not due(Repository(name="o/r", path=".", **ready, **old), {})


def test_interval_has_a_floor():
    repo = Repository(name="o/r", path=".", status="ready", source="github", last_sync={"at": ago(2)})
    assert not due(repo, {"auto_sync_enabled": True, "auto_sync_interval": 1})


# ── the scheduler tick ───────────────────────────────────────────────


def test_tick_syncs_only_due_repositories_with_the_configured_mode(client, monkeypatch):
    upsert(Preference(values={"auto_sync_enabled": True, "auto_sync_interval": 30, "sync_mode": "full"}))
    stale = save(Repository(name="o/stale", path=".", status="ready", last_sync={"at": ago(120)}))
    fresh = save(Repository(name="o/fresh", path=".", status="ready", token_id="x", last_sync={"at": ago(1)}))
    local = save(Repository(name="/tmp/x", path=".", status="ready", source="local", last_sync={"at": ago(999)}))
    calls = []

    async def token_for_repo(repo):
        return "t"

    monkeypatch.setattr(sync, "token_for_repo", token_for_repo)

    async def sync_one(identity, token, user, mode, trigger):
        calls.append((identity, mode, trigger, user))

    done = asyncio.run(sync.auto_sync_tick(sync_one))
    assert done == [stale.id] and calls == [(stale.id, "full", "auto", "auto-sync")]
    assert get(Repository, stale.id).syncing is True
    assert fresh.id not in done and local.id not in done
    assert asyncio.run(sync.auto_sync_tick(sync_one)) == []  # already syncing


def test_tick_does_nothing_when_disabled(client, monkeypatch):
    upsert(Preference(values={"auto_sync_enabled": False}))
    save(Repository(name=settings.demo_repo, path=".", status="ready", last_sync={"at": ago(999)}))

    async def sync_one(*args):
        raise AssertionError("must not sync")

    assert asyncio.run(sync.auto_sync_tick(sync_one)) == []


def test_missing_login_is_recorded_not_raised(client, monkeypatch):
    upsert(Preference(values={"auto_sync_enabled": True, "auto_sync_interval": 30}))
    repo = save(Repository(name="o/private", path=".", status="ready", token_id="gone", last_sync={"at": ago(999)}))

    async def sync_one(*args):
        raise AssertionError("must not sync without a token")

    assert asyncio.run(sync.auto_sync_tick(sync_one)) == []
    saved = get(Repository, repo.id)
    assert saved.status == "ready" and not saved.syncing
    assert "登录" in saved.last_sync["error"] and saved.last_sync["trigger"] == "auto"


def test_token_selection(client, monkeypatch):
    import workbench.sync as module
    from workbench.services import fernet

    monkeypatch.setattr(settings, "demo_github_token", "demo-token")
    demo = Repository(name=settings.demo_repo, path=".")
    assert asyncio.run(module.token_for_repo(demo)) == "demo-token"
    row = save(Token(id="auto-token", encrypted=fernet.encrypt(b'{"access_token": "user-token"}').decode()))
    owned = Repository(name="o/r", path=".", token_id=row.id)
    assert asyncio.run(module.token_for_repo(owned)) == "user-token"
    with pytest.raises(Exception, match="登录"):
        asyncio.run(module.token_for_repo(Repository(name="o/r", path=".")))


# ── endpoints ────────────────────────────────────────────────────────


def ready_repo(**extra):
    return save(Repository(name="o/live", path=".", status="ready", **extra))


def recording_import(monkeypatch):
    """Replace import_repository; arguments are recorded when the endpoint calls it."""
    import workbench.app as routes

    launched = []

    def fake_import(identity, token, user, mode="full", trigger="manual"):
        launched.append((identity, mode, trigger))

        async def nothing():
            return None

        return nothing()

    monkeypatch.setattr(routes, "import_repository", fake_import)
    return launched


def test_manual_sync_modes_and_state(client, monkeypatch):
    login(client, monkeypatch)
    launched = recording_import(monkeypatch)
    repo = ready_repo()
    assert client.post(f"/api/repos/{repo.id}/sync", json={"mode": "bogus"}).status_code == 422
    first = client.post(f"/api/repos/{repo.id}/sync", json={"mode": "full"})
    assert first.status_code == 200
    assert first.json()["status"] == "ready" and first.json()["syncing"] is True
    assert client.post(f"/api/repos/{repo.id}/sync", json={"mode": "full"}).status_code == 409
    assert launched == [(repo.id, "full", "manual")]


def test_manual_sync_uses_the_mode_chosen_in_settings(client, monkeypatch):
    login(client, monkeypatch)
    launched = recording_import(monkeypatch)
    repo = ready_repo()

    def press(**body):
        saved = get(Repository, repo.id)
        saved.syncing = False
        save(saved)
        assert client.post(f"/api/repos/{repo.id}/sync", json=body).status_code == 200

    press()  # nothing configured: incremental
    upsert(Preference(values={"sync_mode": "full"}))
    press()
    press(mode="incremental")  # an explicit mode still wins
    upsert(Preference(values={"sync_mode": "incremental"}))
    press()
    assert [m for _, m, _ in launched] == ["incremental", "full", "incremental", "incremental"]


def test_syncing_an_unfinished_import_always_runs_full(client, monkeypatch):
    login(client, monkeypatch)
    launched = recording_import(monkeypatch)
    repo = save(Repository(name="o/live", path=".", status="error", error="x"))
    response = client.post(f"/api/repos/{repo.id}/sync", json={"mode": "incremental"})
    assert response.status_code == 200 and response.json()["status"] == "importing"
    assert launched == [(repo.id, "full", "manual")]


def test_failed_sync_of_a_ready_repository_keeps_it_usable(client, monkeypatch, tmp_path):
    import workbench.app as routes

    async def broken(*args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(routes, "git", broken)
    repo = save(Repository(name="o/live", path=str(tmp_path), status="ready", syncing=True, issues=[stored(1)]))
    asyncio.run(routes.import_repository(repo.id, "t", "tester", "incremental", "manual"))
    saved = get(Repository, repo.id)
    assert saved.status == "ready" and saved.syncing is False
    assert saved.issues == [stored(1)] and saved.error == ""
    assert "network down" in saved.last_sync["error"]
    assert saved.last_sync["trigger"] == "manual" and saved.last_sync["requested"] == "incremental"


def test_failed_initial_import_still_marks_error(client, monkeypatch, tmp_path):
    import workbench.app as routes

    async def broken(*args, **kwargs):
        raise RuntimeError("clone failed")

    monkeypatch.setattr(routes, "git", broken)
    repo = save(Repository(name=settings.demo_repo, path=str(tmp_path), status="importing", syncing=True))
    asyncio.run(routes.import_repository(repo.id, "t", "tester"))
    saved = get(Repository, repo.id)
    assert saved.status == "error" and "clone failed" in saved.error and saved.syncing is False


def test_successful_sync_records_what_happened(client, monkeypatch, tmp_path):
    import workbench.app as routes

    async def git(*args, **kwargs):
        return "main"

    async def codegraph(*args, **kwargs):
        return {"exit_code": 0, "output": "", "stdout": "{}"}

    async def quiet(*args, **kwargs):
        return None

    fake = FakeGitHub([upstream(1), upstream(2, updated="2026-09-20T00:00:00Z")])
    monkeypatch.setattr(routes, "git", git)
    monkeypatch.setattr(routes, "codegraph", codegraph)
    monkeypatch.setattr(routes, "exclude_runtime_files", quiet)
    monkeypatch.setattr(routes, "source_files", lambda path: [])
    monkeypatch.setattr(sync, "github", fake)
    repo = save(
        Repository(
            name="o/live",
            path=str(tmp_path),
            status="ready",
            syncing=True,
            issues=[stored(1, updated="2026-09-10T00:00:00Z")],
            issues_synced="2026-09-05T00:00:00Z",
        )
    )
    asyncio.run(routes.import_repository(repo.id, "t", "auto-sync", "incremental", "auto"))
    saved = get(Repository, repo.id)
    assert saved.status == "ready" and saved.syncing is False and not saved.error
    assert [i["number"] for i in saved.issues] == [2, 1]
    assert saved.issues_synced and saved.issues_synced > "2026-09-05T00:00:00Z"
    info = saved.last_sync
    assert (info["mode"], info["trigger"], info["added"], info["updated"], info["total"]) == ("incremental", "auto", 1, 0, 2)
    assert info["error"] == "" and info["at"]


# ── settings ─────────────────────────────────────────────────────────


def settings_body(**extra):
    return {"llm_base_url": "https://x/v1", "llm_model": "m", "workspace_dir": ".", **extra}


def test_sync_settings_roundtrip_and_validation(client, monkeypatch):
    login(client, monkeypatch)
    body = client.get("/api/settings").json()
    assert (body["auto_sync_enabled"], body["sync_mode"]) == (False, "incremental")
    assert "auto_sync_mode" not in body
    saved = client.put(
        "/api/settings",
        json=settings_body(auto_sync_enabled=True, auto_sync_interval=15, sync_mode="incremental"),
    )
    assert saved.status_code == 200
    body = saved.json()
    assert (body["auto_sync_enabled"], body["auto_sync_interval"], body["sync_mode"]) == (True, 15, "incremental")
    status = lambda **kw: client.put("/api/settings", json=settings_body(**kw)).status_code
    assert status(auto_sync_interval=4) == 422  # too frequent
    assert status(auto_sync_interval=2000) == 422
    assert status(sync_mode="sometimes") == 422
    # Full sync re-requests everything, so *automatic* full sync must be infrequent.
    assert status(sync_mode="full", auto_sync_enabled=True, auto_sync_interval=30) == 422
    assert status(sync_mode="full", auto_sync_enabled=True, auto_sync_interval=60) == 200
    assert status(sync_mode="full", auto_sync_enabled=False, auto_sync_interval=30) == 200


# ── schema migration ─────────────────────────────────────────────────


def test_existing_databases_gain_the_new_columns(tmp_path):
    from workbench.db import ensure_columns

    engine = create_engine("sqlite:///" + (tmp_path / "old.db").as_posix())
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE repository (id VARCHAR PRIMARY KEY, name VARCHAR, path VARCHAR, source VARCHAR,"
                " status VARCHAR, error VARCHAR, branch VARCHAR, sha VARCHAR, stats JSON, progress JSON,"
                " issues JSON, updated VARCHAR)"
            )
        )
        connection.execute(text("INSERT INTO repository (id, name, path) VALUES ('r1', 'o/r', '.')"))
    ensure_columns(engine)
    ensure_columns(engine)  # idempotent
    columns = {c["name"] for c in inspect(engine).get_columns("repository")}
    assert {"issues_synced", "syncing", "last_sync", "token_id"} <= columns
    with engine.connect() as connection:
        row = connection.execute(text("SELECT issues_synced, syncing, last_sync, token_id FROM repository")).one()
    assert row[0] == "" and not row[1] and row[2] in ("{}", {}) and row[3] == ""


def test_every_table_model_can_gain_columns(tmp_path):
    # A table that exists but lacks columns must be migratable whatever the
    # model is — a hand-kept model list once left `conversation` out.
    from workbench.db import SQLModel, ensure_columns

    engine = create_engine("sqlite:///" + (tmp_path / "old.db").as_posix())
    with engine.begin() as connection:
        for table in SQLModel.metadata.sorted_tables:
            connection.execute(text(f'CREATE TABLE "{table.name}" (id VARCHAR PRIMARY KEY)'))
    ensure_columns(engine)
    for table in SQLModel.metadata.sorted_tables:
        assert {c.name for c in table.columns} <= {
            c["name"] for c in inspect(engine).get_columns(table.name)
        }


def test_issues_without_comments_cost_no_comment_request(monkeypatch):
    # One request per comment-less issue would spend the GitHub rate limit
    # on nothing; the listing already says how many comments there are.
    remote = [upstream(1), upstream(2, comments=1), upstream(3)]
    result, fake = run_sync(monkeypatch, repository([], synced=""), remote, "full")
    assert len(result["issues"]) == 3
    assert [re.search(r"issues/(\d+)", c)[1] for c in fake.comment_paths()] == ["2"]
