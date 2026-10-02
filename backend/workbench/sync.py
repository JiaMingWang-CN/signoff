"""GitHub Issue synchronisation (full or incremental) and the auto-sync scheduler."""

import asyncio
import logging
import time
from datetime import datetime, timezone

from fastapi import HTTPException

from .config import safe_error, settings
from .db import Repository, all_items, audit, get, now, save
from .services import github, preferences, stored_token

log = logging.getLogger(__name__)

PAGE_SIZE = 100
MAX_PAGES = 10
MIN_INTERVAL_MINUTES = 5
CHECK_PERIOD_SECONDS = 30


def issue_record(issue, comments):
    return {
        **{
            k: issue[k]
            for k in (
                "number",
                "title",
                "body",
                "state",
                "html_url",
                "created_at",
                "updated_at",
            )
        },
        "labels": [label["name"] for label in issue["labels"]],
        "comments_text": "\n".join(c["body"] for c in comments),
    }


async def collect_comments(repo, number, token):
    """All comments of one issue, page by page.

    GitHub caps per_page at 100; a single request would silently truncate
    any thread longer than that."""
    comments = []
    for page in range(1, MAX_PAGES + 1):
        batch = await github(
            f"/repos/{repo.name}/issues/{number}/comments"
            f"?per_page={PAGE_SIZE}&page={page}",
            token,
        )
        comments += batch
        if len(batch) < PAGE_SIZE:
            return comments
    return comments


async def sync_issues(repo, token, mode):
    """Fetch issues and return the new list plus a summary.

    "incremental" asks GitHub only for issues updated since the last sync and
    merges them into the stored list; "full" refetches everything and replaces
    it (the only way to notice deleted or transferred issues). Incremental
    falls back to full when there is no baseline yet.
    """
    # Taken before the first request so nothing updated meanwhile is missed.
    started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    effective = (
        "incremental" if mode == "incremental" and repo.issues_synced and repo.issues else "full"
    )
    path = f"/repos/{repo.name}/issues?state=all&per_page={PAGE_SIZE}"
    if effective == "incremental":
        path += "&since=" + repo.issues_synced
    fetched, truncated = [], False
    for page in range(1, MAX_PAGES + 1):
        batch = await github(f"{path}&page={page}", token)
        for issue in batch:
            if "pull_request" in issue:
                continue
            # The listing carries the comment count; most issues have none,
            # and fetching for them anyway would spend one request each.
            comments = (
                await collect_comments(repo, issue["number"], token)
                if issue.get("comments")
                else []
            )
            fetched.append(issue_record(issue, comments))
        if len(batch) < PAGE_SIZE:
            break
        truncated = page == MAX_PAGES
    before = {i["number"]: i for i in repo.issues}
    if effective == "incremental":
        merged = {**before, **{i["number"]: i for i in fetched}}
    else:
        merged = {i["number"]: i for i in fetched}
    return {
        "issues": sorted(merged.values(), key=lambda i: i["number"], reverse=True),
        "mode": effective,
        "fell_back": effective != mode,
        "added": sum(1 for n in merged if n not in before),
        "updated": sum(
            1
            for n, i in merged.items()
            if n in before and before[n].get("updated_at") != i.get("updated_at")
        ),
        "removed": sum(1 for n in before if n not in merged),
        "truncated": truncated,
        "started": started,
    }


def parse_time(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return 0.0


def auto_sync_due(repo, prefs, at):
    if repo.demo:
        return False
    if not prefs.get("auto_sync_enabled"):
        return False
    if repo.source != "github" or repo.status != "ready" or repo.syncing:
        return False
    interval = max(int(prefs.get("auto_sync_interval", 60)), MIN_INTERVAL_MINUTES) * 60
    # A failed attempt also stamps last_sync, so broken repositories back off.
    last = parse_time((repo.last_sync or {}).get("at")) or parse_time(repo.updated)
    return at - last >= interval


async def token_for_repo(repo):
    """The token auto-sync uses: the login that last synced this repository,
    or the server's demo token for the demo repository."""
    if repo.token_id:
        return await stored_token(repo.token_id)
    if repo.name.lower() == settings.demo_repo.lower():
        return settings.demo_github_token
    raise HTTPException(401, "需要重新登录 GitHub 后才能自动同步此仓库")


def record_failure(repo, error, mode, trigger):
    repo = get(Repository, repo.id)
    repo.last_sync = {
        **(repo.last_sync or {}),
        "requested": mode,
        "trigger": trigger,
        "at": now(),
        "error": error,
    }
    save(repo)
    audit("repo_sync_failed", "auto-sync", repo_id=repo.id, error=error)


async def auto_sync_tick(sync_one, at=None):
    """Sync every repository that is due. `sync_one(id, token, user, mode,
    trigger)` performs one sync; returns the ids that were started."""
    prefs = preferences()
    if not prefs.get("auto_sync_enabled"):
        return []
    mode = prefs.get("sync_mode", "incremental")
    at = at or time.time()
    started = []
    for repo in all_items(Repository):
        if not auto_sync_due(repo, prefs, at):
            continue
        try:
            token = await token_for_repo(repo)
        except HTTPException as error:
            record_failure(repo, str(error.detail), mode, "auto")
            continue
        repo.syncing = True
        save(repo)
        started.append(repo.id)
        await sync_one(repo.id, token, "auto-sync", mode, "auto")
    return started


async def auto_sync_loop(sync_one, period=CHECK_PERIOD_SECONDS):
    while True:
        await asyncio.sleep(period)
        try:
            await auto_sync_tick(sync_one)
        except Exception as error:
            log.exception("auto-sync tick failed: %s", safe_error(error))
