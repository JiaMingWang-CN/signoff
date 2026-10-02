import asyncio
import csv
import io
import ipaddress
import json
import re
import secrets
import shutil
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode, urlparse

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import (
    JSONResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from pydantic import (
    BaseModel,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)
from starlette.middleware.sessions import SessionMiddleware

from .agent import RunConfig, approvals, emit, jobs, run_agent, tests_ok, verify
from .config import safe_error, settings
from .identity import client_address, guest_address, quota_actor
from .db import (
    Audit,
    Event,
    Plan,
    Preference,
    Repository,
    Run,
    Scan,
    Token,
    all_items,
    audit,
    count_items,
    delete_items,
    engine,
    events_after,
    find_issues,
    get,
    index_issues,
    initialize,
    now,
    save,
    uid,
    upsert,
)
from .planning import Capacity, PlanInput, Task, schedule
from .qa import answer_question
from .security import pause_review, review_findings, scan_repository
from .services import (
    ask,
    codegraph,
    codegraph_status,
    exclude_runtime_files,
    DEFAULT_LLM_BASE_URL,
    fernet,
    git,
    github,
    github_token,
    llm_api_key,
    oauth_token,
    preferences,
    source_files,
)
from .sync import auto_sync_loop, sync_issues

background: set[asyncio.Task] = set()


def launch(coroutine):
    task = asyncio.create_task(coroutine)
    background.add(task)
    task.add_done_callback(background.discard)
    return task


async def reclaim_worktrees():
    """Remove worktrees of runs that ended more than a day ago.

    Each run owns a git worktree; without reclamation, disk usage and the
    worktree list grow without bound. Only worktrees with nothing left to
    keep are removed: a run whose PR was pushed (the branch holds its work)
    or one that failed or was stopped. A completed or needs-review run
    without a PR still holds the only copy of its changes, which the user
    may yet turn into a PR, so it is never touched."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    for repo in all_items(Repository):
        if repo.demo:
            continue
        if not Path(repo.path).exists():
            continue
        for run in all_items(Run, repo_id=repo.id):
            if (
                not (run.pr_url or run.status in ("failed", "stopped", "rejected"))
                or not run.path
                or not Path(run.path).exists()
                or (run.finished and run.finished > cutoff)
            ):
                continue
            try:
                await git("worktree", "remove", "--force", run.path, cwd=repo.path)
            except RuntimeError:
                shutil.rmtree(run.path, ignore_errors=True)
            try:
                await git("worktree", "prune", cwd=repo.path)
            except RuntimeError:
                pass
            audit("worktree_reclaimed", "local", run_id=run.id, repo_id=repo.id)


@asynccontextmanager
async def lifespan(app):
    initialize()
    launch(reclaim_worktrees())
    launch(auto_sync_loop(import_repository))
    yield
    tasks = list(background | set(jobs.values()))
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="Signoff", lifespan=lifespan)


@app.middleware("http")
async def check_origin(request, call_next):
    validate_session(request)
    if not request.session.get("user"):
        actor(request)
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != settings.public_url.rstrip("/"):
            return JSONResponse({"detail": "请求来源不被允许"}, 403)
    context = guest_address.set(client_address(request))
    try:
        return await call_next(request)
    finally:
        guest_address.reset(context)


# The session must be decoded before the authentication/origin middleware.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.app_secret,
    https_only=settings.public_url.startswith("https"),
    same_site="lax",
    max_age=30 * 86400,
)


@app.exception_handler(Exception)
async def failure(request, error):
    return JSONResponse({"detail": safe_error(error)}, 500)


def validate_session(request):
    user = request.session.get("user")
    if not user:
        return
    allowed = {u.strip().lower() for u in settings.allowed_github_users.split(",") if u.strip()}
    exposed = (urlparse(settings.public_url).hostname or "").lower() not in ("127.0.0.1", "localhost", "::1")
    try:
        get(Token, request.session.get("token_id") or "")
    except HTTPException:
        request.session.clear()
        return
    login = user.get("login", "").lower()
    if not login or (allowed and login not in allowed) or (exposed and not allowed):
        request.session.clear()


def actor(request):
    validate_session(request)
    login = (request.session.get("user") or {}).get("login")
    if login:
        return login
    if not request.session.get("guest_id"):
        request.session["guest_id"] = secrets.token_urlsafe(32)
    return "guest:" + request.session["guest_id"]


def require_login(request, message="此操作需要 GitHub 登录"):
    validate_session(request)
    if not request.session.get("user"):
        raise HTTPException(401, message)


def require_allowlist_when_exposed():
    """When the service is reachable beyond localhost, an empty login
    allowlist would admit any GitHub account, including the settings page
    that can redirect the LLM key to another host."""
    if any(user.strip() for user in settings.allowed_github_users.split(",")):
        return
    host = (urlparse(settings.public_url).hostname or "").lower()
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise HTTPException(
            503, "对外访问时必须在 .env 配置 ALLOWED_GITHUB_USERS 后才允许登录"
        )


def repo_for(request, identity, ready=True):
    validate_session(request)
    repo = get(Repository, identity)
    if (
        repo.source == "local" or repo.name.lower() != settings.demo_repo.lower()
    ) and not request.session.get("user"):
        raise HTTPException(401, "此仓库需要 GitHub 登录")
    if ready and repo.status != "ready":
        raise HTTPException(409, "仓库尚未导入完成")
    return repo


def run_for(request, identity):
    run = get(Run, identity)
    repo_for(request, run.repo_id)
    if not request.session.get("user") and run.actor != actor(request):
        raise HTTPException(404, "记录不存在")
    return run


def visible_items(model, request, repo_id):
    filters = {"repo_id": repo_id}
    if not request.session.get("user"):
        filters["actor"] = actor(request)
    return all_items(model, **filters)


def owned_record(model, request, identity):
    item = get(model, identity)
    repo_for(request, item.repo_id)
    if not request.session.get("user") and item.actor != actor(request):
        raise HTTPException(404, "记录不存在")
    return item


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.2.0", "codegraph": await codegraph_status()}


@app.get("/api/auth/me")
def me(request: Request):
    return {
        "user": request.session.get("user"),
        "demo_repo": settings.demo_repo,
        "oauth_configured": bool(
            settings.github_client_id and settings.github_client_secret
        ),
    }


@app.get("/api/auth/github/login")
def login(request: Request):
    if not settings.github_client_id or not settings.github_client_secret:
        return RedirectResponse(settings.public_url + "/repos?notice=entry-unavailable")
    try:
        require_allowlist_when_exposed()
    except HTTPException as error:
        if error.status_code != 503:
            raise
        return RedirectResponse(settings.public_url + "/repos?notice=entry-unavailable")
    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state
    return RedirectResponse(
        "https://github.com/login/oauth/authorize?"
        + urlencode(
            {
                "client_id": settings.github_client_id,
                "scope": settings.github_oauth_scopes,
                "state": state,
                "redirect_uri": settings.public_url + "/api/auth/github/callback",
            }
        )
    )


@app.get("/api/auth/github/callback")
async def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    expected = request.session.pop("oauth_state", "")
    if error:
        raise HTTPException(400, "GitHub 授权未完成：" + error)
    if not code or not expected or not secrets.compare_digest(state, expected):
        raise HTTPException(400, "OAuth state 校验失败")
    data = await oauth_token(
        {
            "code": code,
            "redirect_uri": settings.public_url + "/api/auth/github/callback",
        }
    )
    user = await github("/user", data["access_token"])
    allowed = [u.strip().lower() for u in settings.allowed_github_users.split(",")]
    if any(allowed) and user["login"].lower() not in allowed:
        raise HTTPException(403, "此 GitHub 账号不在允许登录的名单中")
    identity = uid("token")
    save(
        Token(
            id=identity,
            encrypted=fernet.encrypt(json.dumps(data).encode()).decode(),
            expires=time.time() + data.get("expires_in", 0)
            if data.get("expires_in")
            else 0,
        )
    )
    request.session.clear()
    request.session["token_id"] = identity
    request.session["user"] = {k: user[k] for k in ["login", "avatar_url", "html_url"]}
    audit("login", user["login"])
    return RedirectResponse(settings.public_url + "/repos")


@app.post("/api/auth/logout")
def logout(request: Request):
    user = actor(request)
    identity = request.session.get("token_id")
    if identity:
        from sqlmodel import Session

        with Session(engine) as session:
            token = session.get(Token, identity)
            if token:
                session.delete(token)
                session.commit()
    audit("logout", user)
    request.session.clear()
    return {"ok": True}


async def github_repo_info(name, token, guest=False):
    try:
        return await github("/repos/" + name, token)
    except HTTPException as error:
        if guest and error.status_code in (401, 403):
            raise HTTPException(503, "暂未开放入口") from error
        raise


@app.get("/api/github/repos")
async def github_repos(request: Request):
    token = await github_token(request)
    if not request.session.get("user"):
        data = await github_repo_info(settings.demo_repo, token, guest=True)
        return [data]
    result = []
    for page in range(1, 11):
        batch = await github(
            f"/user/repos?per_page=100&page={page}&sort=updated&affiliation=owner,collaborator,organization_member",
            token,
        )
        result += batch
        if len(batch) < 100:
            break
    return result


@app.get("/api/repos")
def repos(request: Request):
    return [
        r
        for r in all_items(Repository)
        if request.session.get("user")
        or (r.source == "github" and r.name.lower() == settings.demo_repo.lower())
    ]


class ImportInput(BaseModel):
    name: str = ""
    local_path: str = ""


sync_locks: dict[str, asyncio.Lock] = {}


async def import_repository(identity, token, user, mode="full", trigger="manual"):
    """Clone/pull, index and sync issues. A repository that is already ready
    stays usable throughout and after a failure; only a first import marks it
    importing / error."""
    # One repository at a time: a manual sync and the auto-sync loop would
    # otherwise race on the same clone and clobber the columns the other
    # just wrote (the ready / syncing checks alone leave a TOCTOU gap).
    async with sync_locks.setdefault(identity, asyncio.Lock()):
        await _import_repository(identity, token, user, mode, trigger)


async def _import_repository(identity, token, user, mode, trigger):
    repo = get(Repository, identity)
    if repo.demo and repo.status == "ready":
        return
    initial = repo.status != "ready"
    began = time.monotonic()
    path = Path(repo.path)
    repo.syncing = True
    save(repo)
    try:
        if not path.exists():
            source = (
                repo.name
                if repo.source == "local"
                else "https://github.com/" + repo.name + ".git"
            )
            await git("clone", "--no-hardlinks", source, str(path), token=token)
            repo.progress = [
                *repo.progress,
                {"step": "clone", "status": "complete", "at": now()},
            ]
            save(repo)
        else:
            await git("pull", "--ff-only", cwd=path, token=token)
            repo.progress = [
                *repo.progress,
                {"step": "pull", "status": "complete", "at": now()},
            ]
            save(repo)
        repo.branch = await git("branch", "--show-current", cwd=path)
        repo.sha = await git("rev-parse", "HEAD", cwd=path)
        await exclude_runtime_files(path)
        index = await codegraph(
            "sync" if (path / ".codegraph").exists() else "init", path=path
        )
        repo.progress = [
            *repo.progress,
            {
                "step": "index",
                "status": "complete" if not index["exit_code"] else "error",
                "output": index["output"],
                "at": now(),
            },
        ]
        save(repo)
        if index["exit_code"]:
            raise ValueError("CodeGraph 建索引失败：" + index["output"][-2000:])
        stats = await codegraph("status", path=path, json_output=True)
        try:
            repo.stats = json.loads(stats["stdout"])
        except ValueError:
            repo.stats = {"output": stats["output"]}
        # Walking the whole worktree blocks the event loop; run it off-thread.
        files = await asyncio.to_thread(source_files, path)
        languages = {}
        for file in files:
            languages[file.suffix] = languages.get(file.suffix, 0) + 1
        repo.stats = {**repo.stats, "file_count": len(files), "languages": languages}
        result = {}
        if repo.source == "github":
            result = await sync_issues(repo, token, mode)
            repo.issues = result["issues"]
            repo.issues_synced = result["started"]
        repo.progress = [
            *repo.progress,
            {
                "step": "issues",
                "status": "complete",
                "count": len(repo.issues),
                "mode": result.get("mode"),
                "at": now(),
            },
        ]
        repo.status = "ready"
        repo.error = ""
        repo.updated = now()
        repo.syncing = False
        repo.last_sync = {
            "mode": result.get("mode") or "code",
            "requested": mode,
            "trigger": trigger,
            "at": now(),
            "added": result.get("added", 0),
            "updated": result.get("updated", 0),
            "removed": result.get("removed", 0),
            "total": len(repo.issues),
            "fell_back": result.get("fell_back", False),
            "truncated": result.get("truncated", False),
            "duration": round(time.monotonic() - began, 1),
            "error": "",
        }
        save(repo)
        await asyncio.to_thread(index_issues, repo)
        audit(
            "repo_imported" if initial else "repo_synced",
            user,
            repo_id=repo.id,
            name=repo.name,
            sha=repo.sha,
            mode=repo.last_sync["mode"],
            trigger=trigger,
        )
    except asyncio.CancelledError:
        # A cancelled sync leaves syncing=True; the manual endpoint would
        # then keep reporting a sync that nothing is driving.
        repo = get(Repository, identity)
        repo.syncing = False
        repo.last_sync = {
            **(repo.last_sync or {}),
            "requested": mode,
            "trigger": trigger,
            "at": now(),
            "error": "同步被中断",
        }
        save(repo)
        raise
    except Exception as error:
        message = safe_error(error)
        repo = get(Repository, identity)
        repo.syncing = False
        if initial:
            repo.status = "error"
            repo.error = message
        repo.last_sync = {
            **(repo.last_sync or {}),
            "requested": mode,
            "trigger": trigger,
            "at": now(),
            "error": message,
        }
        save(repo)
        audit(
            "repo_import_failed" if initial else "repo_sync_failed",
            user,
            repo_id=repo.id,
            error=message,
            trigger=trigger,
        )


@app.post("/api/repos/import")
async def import_repo(body: ImportInput, request: Request):
    if body.local_path:
        require_login(request, "导入本机仓库需要 GitHub 登录")
        path = Path(body.local_path).expanduser().resolve()
        if not path.is_dir():
            raise HTTPException(422, "本地目录不存在")
        name = await git("rev-parse", "--show-toplevel", cwd=path)
        source = "local"
    else:
        name = body.name.strip() or settings.demo_repo
        source = "github"
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", name):
            raise HTTPException(422, "请输入 owner/repository")
        if (
            not request.session.get("user")
            and name.lower() != settings.demo_repo.lower()
        ):
            raise HTTPException(401, "请先使用 GitHub 登录")
    existing = next((r for r in all_items(Repository) if r.name == name), None)
    if existing and existing.status in ["ready", "importing"]:
        return existing
    tool = await codegraph_status()
    if not tool["available"]:
        raise HTTPException(503, tool["hint"])
    token = await github_token(request)
    if source == "github":
        await github_repo_info(name, token, guest=not request.session.get("user"))
    if existing:
        repo = existing
        repo.status = "importing"
        repo.progress = []
        repo.error = ""
        repo.token_id = request.session.get("token_id") or repo.token_id
        save(repo)
    else:
        root = (
            Path(preferences().get("workspace_dir", settings.workspace_dir))
            .expanduser()
            .resolve()
        )
        root.mkdir(parents=True, exist_ok=True)
        repo = Repository(
            name=name,
            path=str(
                root
                / (
                    re.sub(
                        r"[^\w.-]", "__", Path(name).name if source == "local" else name
                    )
                    + "__"
                    + secrets.token_hex(3)
                )
            ),
            source=source,
            token_id=request.session.get("token_id") or "",
        )
        save(repo)
    launch(import_repository(repo.id, token, actor(request)))
    return repo


@app.get("/api/repos/{identity}")
def repository(identity: str, request: Request):
    return repo_for(request, identity, False)


class SyncInput(BaseModel):
    # Omitted: use the sync mode chosen in settings.
    mode: Literal["incremental", "full"] | None = None


@app.post("/api/repos/{identity}/sync")
async def sync_repo(
    identity: str, request: Request, body: SyncInput | None = None
):
    repo = repo_for(request, identity, False)
    if repo.demo:
        return {**repo.model_dump(), "simulated": True, "message": "示例仓库仅预览同步，未拉取或改动任何源码。"}
    if repo.syncing or repo.status == "importing":
        raise HTTPException(409, "同步正在进行")
    initial = repo.status != "ready"
    mode = (
        "full"
        if initial
        else (body and body.mode) or preferences().get("sync_mode", "incremental")
    )
    token = await github_token(request)
    repo.syncing = True
    repo.progress = []
    repo.token_id = request.session.get("token_id") or repo.token_id
    if initial:
        # An unfinished first import cannot be used until it completes.
        repo.status = "importing"
        repo.error = ""
    save(repo)
    launch(import_repository(identity, token, actor(request), mode, "manual"))
    return repo


@app.get("/api/repos/{identity}/search")
async def search_repo(
    identity: str,
    request: Request,
    q: str = Query(default="", max_length=500),
    kind: Literal["code", "issue"] = "code",
    mode: Literal["explore", "query", "callers", "callees", "impact"] = "explore",
    state: str = "all",
    label: str = "",
):
    repo = repo_for(request, identity)
    if not q.strip():
        return {"text": "", "issues": []}
    if kind == "issue":
        return {"issues": find_issues(repo, q, state, label)}
    if q.startswith("-"):
        raise HTTPException(422, "检索内容不能以选项标记开头")
    output = await codegraph(mode, q, repo.path)
    if output["exit_code"]:
        raise HTTPException(502, output["output"])
    return {"text": output["output"], "mode": mode, "sha": repo.sha}


class Question(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)


@app.post("/api/repos/{identity}/ask")
async def ask_repo(identity: str, body: Question, request: Request):
    repo = repo_for(request, identity)
    return await answer_question(repo, body.prompt, actor(request))


@app.get("/api/repos/{identity}/scans")
def scans(identity: str, request: Request):
    repo_for(request, identity)
    return visible_items(Scan, request, identity)[::-1]


@app.post("/api/repos/{identity}/scans")
async def scan(identity: str, request: Request):
    repo = repo_for(request, identity)
    if any(s.status == "running" for s in all_items(Scan, repo_id=identity)):
        raise HTTPException(409, "扫描正在进行")
    item = save(Scan(repo_id=identity, sha=repo.sha, actor=actor(request)))
    launch(scan_repository(item.id, actor(request)))
    audit("scan_started", actor(request), scan_id=item.id)
    return item


@app.post("/api/scans/{identity}/review")
async def review(identity: str, request: Request):
    scan = owned_record(Scan, request, identity)
    if scan.status != "complete":
        raise HTTPException(409, "请等待扫描完成")
    return await review_findings(scan, actor(request))


@app.post("/api/scans/{identity}/review/pause")
async def pause_scan_review(identity: str, request: Request):
    scan = owned_record(Scan, request, identity)
    if not pause_review(identity):
        raise HTTPException(409, "当前没有进行中的复核")
    return get(Scan, identity)


def with_status(finding, status):
    """A person's decision replaces whatever the AI decided."""
    return {
        **{k: v for k, v in finding.items() if k != "handled_by"},
        "status": status,
    }


class FindingStatus(BaseModel):
    status: Literal["open", "ignored", "planned"]


@app.patch("/api/scans/{identity}/findings/{finding_id}")
def finding_status(
    identity: str, finding_id: str, body: FindingStatus, request: Request
):
    scan = owned_record(Scan, request, identity)
    if not any(f["id"] == finding_id for f in scan.findings):
        raise HTTPException(404, "发现不存在")
    scan.findings = [
        with_status(f, body.status) if f["id"] == finding_id else f
        for f in scan.findings
    ]
    save(scan)
    audit(
        "finding_status",
        actor(request),
        scan_id=identity,
        finding_id=finding_id,
        status=body.status,
    )
    return scan


class FindingsStatus(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)
    status: Literal["open", "ignored"]


@app.post("/api/scans/{identity}/findings/status")
def findings_status(identity: str, body: FindingsStatus, request: Request):
    scan = owned_record(Scan, request, identity)
    known = {f["id"] for f in scan.findings}
    missing = [i for i in body.ids if i not in known]
    if missing:
        raise HTTPException(404, "发现不存在：" + ", ".join(missing[:5]))
    chosen = set(body.ids)
    scan.findings = [
        with_status(f, body.status) if f["id"] in chosen else f
        for f in scan.findings
    ]
    save(scan)
    audit(
        "findings_status",
        actor(request),
        scan_id=identity,
        count=len(chosen),
        status=body.status,
    )
    return scan


@app.get("/api/repos/{identity}/plans")
def plans(identity: str, request: Request):
    repo_for(request, identity)
    return visible_items(Plan, request, identity)[::-1]


@app.delete("/api/repos/{identity}/plans")
def clear_plans(identity: str, request: Request):
    """Drop every plan, schedule and version of this repository so the work
    starts again from scanning. Scans, Issues and run history are kept."""
    repo_for(request, identity)
    filters = {} if request.session.get("user") else {"actor": actor(request)}
    deleted = delete_items(Plan, repo_id=identity, **filters)
    audit("plans_cleared", actor(request), repo_id=identity, deleted=deleted)
    return {"deleted": deleted}


@app.post("/api/repos/{identity}/plan")
async def draft_plan(identity: str, request: Request):
    repo = repo_for(request, identity)
    # Planning is the step after scanning: it works from a finished scan.
    finished = [s for s in visible_items(Scan, request, identity) if s.status == "complete"]
    if not finished:
        raise HTTPException(409, "请先在“漏洞分析”完成一次扫描，再汇总规划")
    findings = finished[-1].findings
    evidence = {
        "issues": [i for i in repo.issues if i["state"] == "open"],
        "findings": [f for f in findings if f["status"] != "ignored"],
        "stats": repo.stats,
    }
    if not evidence["issues"] and not evidence["findings"]:
        raise HTTPException(409, "暂无问题，请先扫描仓库或同步 Issue")
    result = await ask(
        '汇总去重问题并拆分任务。输出 {"summary":"中文摘要","tasks":[{"id":"T1","title":"任务","why":"估算与执行方理由","src":"Issue/SEC 引用","dep":"前置任务 ID 或 —","h":2,"who":"agent 或 human","priority":0}]}。priority 0 最高、4 最低。任务只来源于证据，最多 30 项；需要人工业务决策建议 human。不给日期。',
        json.dumps(evidence, ensure_ascii=False)[:48000],
        actor(request),
        True,
        "plan",
    )
    try:
        tasks = [
            Task.model_validate(t).model_dump(mode="json") for t in result["tasks"]
        ]
        schedule([Task.model_validate(t) for t in tasks], Capacity())
    except (KeyError, ValueError, ValidationError) as error:
        raise HTTPException(502, "规划数据无效：" + safe_error(error))
    plan = save(
        Plan(
            repo_id=identity,
            actor=actor(request),
            tasks=tasks,
            capacity=Capacity().model_dump(mode="json"),
            summary=str(result.get("summary", "")),
            version=len(visible_items(Plan, request, identity)) + 1,
        )
    )
    audit("plan_drafted", actor(request), plan_id=plan.id)
    return plan


@app.post("/api/repos/{identity}/schedule")
def generate_schedule(identity: str, body: PlanInput, request: Request):
    repo_for(request, identity)
    if not visible_items(Plan, request, identity):
        raise HTTPException(409, "请先汇总问题并拆分任务，再生成排期")
    try:
        calendar = schedule(body.tasks, body.capacity)
    except ValueError as error:
        raise HTTPException(422, str(error))
    plan = save(
        Plan(
            repo_id=identity,
            actor=actor(request),
            tasks=[t.model_dump(mode="json") for t in body.tasks],
            capacity=body.capacity.model_dump(mode="json"),
            calendar=calendar,
            status="applied",
            version=len(visible_items(Plan, request, identity)) + 1,
        )
    )
    audit("schedule_applied", actor(request), plan_id=plan.id, version=plan.version)
    return plan


@app.post("/api/plans/{identity}/adjust")
async def adjust(identity: str, body: Question, request: Request):
    plan = owned_record(Plan, request, identity)
    result = await ask(
        '把用户要求转为修改后的完整任务和容量，输出 {"summary":"逐项变更解释","tasks":[...],"capacity":{...}}。保持未提及字段不变，不能增加或删除任务；把任务安排到具体某一天（包括周末等休息日）用任务 on 字段（YYYY-MM-DD），不早于某天用 not_before；除非用户明确要求改变工作日，不要修改 capacity.weekdays；任务 dep 不改变。',
        json.dumps(
            {"request": body.prompt, "tasks": plan.tasks, "capacity": plan.capacity},
            ensure_ascii=False,
        ),
        actor(request),
        True,
        "plan",
    )
    try:
        value = PlanInput.model_validate(result)
        if {t.id for t in value.tasks} != {t["id"] for t in plan.tasks}:
            raise ValueError("不能增加或删除任务")
        if any(
            t.dep != next(x["dep"] for x in plan.tasks if x["id"] == t.id)
            for t in value.tasks
        ):
            raise ValueError("不能修改任务依赖")
        calendar = schedule(value.tasks, value.capacity)
    except (ValueError, ValidationError) as error:
        raise HTTPException(422, "无法应用调整：" + safe_error(error))
    preview = save(
        Plan(
            repo_id=plan.repo_id,
            actor=actor(request),
            tasks=[t.model_dump(mode="json") for t in value.tasks],
            capacity=value.capacity.model_dump(mode="json"),
            calendar=calendar,
            status="preview",
            summary=str(result.get("summary", "")),
            version=len(visible_items(Plan, request, plan.repo_id)) + 1,
        )
    )
    audit("schedule_preview", actor(request), plan_id=preview.id)
    return preview


@app.post("/api/plans/{identity}/apply")
def apply_plan(identity: str, request: Request):
    plan = owned_record(Plan, request, identity)
    if plan.status == "applied":
        plan = Plan(
            repo_id=plan.repo_id,
            actor=actor(request),
            tasks=plan.tasks,
            capacity=plan.capacity,
            calendar=plan.calendar,
            summary="恢复 v" + str(plan.version),
            version=len(visible_items(Plan, request, plan.repo_id)) + 1,
            status="applied",
        )
    else:
        plan.status = "applied"
    save(plan)
    audit("schedule_applied", actor(request), plan_id=plan.id, version=plan.version)
    return plan


class StartRun(BaseModel):
    task: Task
    config: RunConfig = Field(default_factory=RunConfig)


@app.get("/api/repos/{identity}/runs")
def runs(identity: str, request: Request):
    repo_for(request, identity)
    return visible_items(Run, request, identity)[::-1]


@app.post("/api/repos/{identity}/runs")
async def start_run(identity: str, body: StartRun, request: Request):
    repo = repo_for(request, identity)
    user = actor(request)
    guest = user.startswith("guest:")
    if guest:
        if body.config.preset not in ("readonly", "approve"):
            raise HTTPException(401, "访客只能使用只读或逐步审批预设")
        if body.config.directory or body.config.test_command:
            raise HTTPException(401, "自定义目录与自定义测试命令需要 GitHub 登录")
        # A visitor cannot widen its own permissions: the tool overrides and
        # bash rules belong to the repository owner, and a client-supplied
        # preset alone would let a guest silently reach auto/full.
        body.config.tools = {}
        body.config.bash_allow = []
        body.config.bash_deny = []
    if repo.demo:
        body.config.preset = "readonly" if body.config.preset == "readonly" else "approve"
        body.config.tools = {}
        body.config.directory = ""
        body.config.test_command = ""
        body.config.bash_allow = []
        body.config.bash_deny = []
    if body.config.preset == "full" and not body.config.full_confirmed:
        raise HTTPException(422, "完全权限需要二次确认")
    pref = preferences()
    for key in ("bash_allow", "bash_deny"):
        if not getattr(body.config, key):
            setattr(body.config, key, pref.get(key, []))
    if guest:
        count = count_items(Run, quota_actor=quota_actor(user), created__startswith=now()[:10])
        if count >= settings.guest_daily_agent_runs:
            raise HTTPException(429, "今日访客运行次数已达上限")
    if any(
        r.status in ("starting", "running", "waiting")
        for r in all_items(Run, repo_id=identity)
    ):
        raise HTTPException(409, "此仓库已有运行，请先完成或停止")
    run = save(
        Run(
            repo_id=identity,
            task=body.task.model_dump(mode="json"),
            config={**body.config.model_dump(), **({"simulated": True} if repo.demo else {})},
            actor=user,
            quota_actor=quota_actor(user),
        )
    )
    jobs[run.id] = launch(run_agent(run.id))
    audit("agent_started", user, run_id=run.id)
    return run


@app.get("/api/runs/{identity}")
def run_detail(identity: str, request: Request):
    run = run_for(request, identity)
    events = all_items(Event, run_id=identity)
    return {
        **run.model_dump(),
        "events": [e.model_dump() for e in events],
        "hash_valid": verify(events),
    }


# Live viewers per run. Streaming the whole history to everyone would let
# a run's own event table be re-read from disk once per connected tab.
sse_viewers: dict[str, int] = {}


@app.get("/api/runs/{identity}/events")
async def run_events(identity: str, request: Request, after: int = 0):
    run_for(request, identity)
    last = request.headers.get("last-event-id", "")
    after = max(after, int(last) if last.isdigit() else 0)
    if sse_viewers.get(identity, 0) >= 10:
        raise HTTPException(429, "此运行的事件连接数已达上限")

    async def stream():
        sse_viewers[identity] = sse_viewers.get(identity, 0) + 1
        cursor = after
        try:
            while not await request.is_disconnected():
                # Only the events newer than the cursor are fetched, so a
                # long run no longer re-reads its whole history each second.
                batch = events_after(identity, cursor)
                for event in batch:
                    yield (
                        f"id: {event.id}\n"
                        f"data: {json.dumps(event.model_dump(), ensure_ascii=False)}\n\n"
                    )
                    cursor = event.id
                if len(batch) == 200:
                    continue  # keep draining a long backlog without sleeping
                if get(Run, identity).status not in ["starting", "running", "waiting"]:
                    yield "event: done\ndata: {}\n\n"
                    return
                yield ": heartbeat\n\n"
                await asyncio.sleep(1)
        finally:
            sse_viewers[identity] = max(0, sse_viewers.get(identity, 0) - 1)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class Decision(BaseModel):
    decision: Literal["approve", "reject", "always"]


@app.post("/api/runs/{identity}/approvals/{approval_id}")
async def decide(identity: str, approval_id: str, body: Decision, request: Request):
    run = run_for(request, identity)
    # Approval is the safety gate on the agent's writes. An anonymous
    # bystander must not decide a run started by someone else.
    if run.actor != actor(request) and not request.session.get("user"):
        raise HTTPException(403, "只有运行发起者或已登录用户可以审批")
    pending = approvals.get(approval_id)
    if not pending or pending[0] != identity or pending[1].done():
        raise HTTPException(409, "审批已结束或不存在")
    try:
        pending[1].set_result((body.decision, actor(request)))
    except asyncio.InvalidStateError:
        # Two browsers decided between the done() check and now.
        raise HTTPException(409, "审批已结束或不存在")
    return {"ok": True}


@app.post("/api/runs/{identity}/stop")
async def stop_run(identity: str, request: Request):
    run = run_for(request, identity)
    if run.actor != actor(request) and not request.session.get("user"):
        raise HTTPException(403, "只有运行发起者或已登录用户可以停止")
    job = jobs.get(identity)
    if not job:
        raise HTTPException(409, "运行已结束")
    job.cancel()
    await asyncio.gather(job, return_exceptions=True)
    return get(Run, identity)


class FollowUp(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@app.post("/api/runs/{identity}/messages")
async def follow_up(identity: str, body: FollowUp, request: Request):
    """Continue a finished run in its own worktree with another message."""
    run = run_for(request, identity)
    if run.actor != actor(request) and not request.session.get("user"):
        raise HTTPException(403, "只有运行发起者或已登录用户可以追问")
    if run.pr_url:
        raise HTTPException(409, "已创建 PR，请新开对话")
    if (
        run.status not in ("completed", "needs_review", "accepted", "stopped", "failed")
        or not run.path
        or not Path(run.path).exists()
    ):
        raise HTTPException(409, "此运行不能继续追问")
    if identity in jobs or any(
        r.status in ("starting", "running", "waiting")
        for r in all_items(Run, repo_id=run.repo_id)
    ):
        raise HTTPException(409, "此仓库已有运行，请先完成或停止")
    # Claim the run before the job starts so a double click cannot start two.
    run.status = "running"
    save(run)
    jobs[run.id] = launch(run_agent(run.id, body.text))
    audit("agent_follow_up", actor(request), run_id=run.id)
    return run


class RunReview(BaseModel):
    decision: Literal["accept", "reject"]


@app.post("/api/runs/{identity}/review")
async def review_run(identity: str, body: RunReview, request: Request):
    """A person decides a run that ended needing review (failing tests, or a
    limit reached): accepting lets them open a PR for it, rejecting closes it."""
    run = run_for(request, identity)
    require_login(request, "审核运行需要 GitHub 登录")
    if run.status != "needs_review":
        raise HTTPException(409, "只有“需要审核”的运行可以审核")
    if body.decision == "accept" and not run.diff:
        raise HTTPException(409, "运行没有代码变更，无需通过审核")
    run.status = "accepted" if body.decision == "accept" else "rejected"
    save(run)
    await emit(
        run.id,
        "reviewed",
        {
            "decision": body.decision,
            "actor": actor(request),
            "tests_passed": tests_ok(run.tests),
        },
    )
    audit("run_reviewed", actor(request), run_id=run.id, decision=body.decision)
    return get(Run, identity)


pr_locks: dict[str, asyncio.Lock] = {}


async def push_target(repo, run, token):
    """Return (remote, head) — the repository itself when the user can push to
    it, otherwise the user's fork."""
    info = await github("/repos/" + repo.name, token)
    if (info.get("permissions") or {}).get("push"):
        return "origin", run.branch
    fork = (await github("/repos/" + repo.name + "/forks", token, "POST", {}))[
        "full_name"
    ]
    for _ in range(30):
        try:
            await github("/repos/" + fork, token)
            break
        except HTTPException as error:
            if error.status_code != 404:
                raise
            await asyncio.sleep(2)
    else:
        raise HTTPException(504, "Fork 尚未就绪，请稍后重试")
    return f"https://github.com/{fork}.git", f"{fork.split('/')[0]}:{run.branch}"


@app.post("/api/runs/{identity}/pr")
async def create_pr(identity: str, request: Request):
    run = run_for(request, identity)
    repo = repo_for(request, run.repo_id)
    if repo.demo:
        return {
            "simulated": True, "url": "", "title": run.task.get("title", ""), "diff": run.diff,
            "message": "PR 模拟预览：未提交、未推送、未创建 Pull Request。",
        }
    if not request.session.get("user"):
        raise HTTPException(401, "创建 PR 需要 GitHub 登录")
    if repo.source != "github":
        raise HTTPException(409, "本地仓库未连接 GitHub，不能创建 PR")
    if run.status not in ("completed", "accepted") or not run.diff:
        raise HTTPException(409, "运行须完成（或经人工审核通过）且有代码变更")
    async with pr_locks.setdefault(identity, asyncio.Lock()):
        run = get(Run, identity)
        if run.pr_url:
            return {"url": run.pr_url}
        token = await github_token(request)
        await git("add", ".", cwd=run.path)
        if not run.commit_sha:
            await git(
                "-c",
                "user.name=" + request.session["user"]["login"],
                "-c",
                "user.email="
                + request.session["user"]["login"]
                + "@users.noreply.github.com",
                "commit",
                "-m",
                run.task["title"],
                cwd=run.path,
            )
            run.commit_sha = await git("rev-parse", "HEAD", cwd=run.path)
            save(run)
        remote, head = await push_target(repo, run, token)
        await git("push", remote, run.branch, cwd=run.path, token=token)
        result = await github(
            "/repos/" + repo.name + "/pulls",
            token,
            "POST",
            {
                "title": run.task["title"],
                "head": head,
                "base": repo.branch,
                "body": f"## Changes\n{run.task['title']}\n\nRun: {run.id}\nCommit: {run.commit_sha}",
            },
        )
        run.pr_url = result["html_url"]
        save(run)
        await emit(
            run.id,
            "pr_created",
            {"url": run.pr_url, "commit_sha": run.commit_sha, "actor": actor(request)},
        )
        audit("pr_created", actor(request), run_id=run.id, url=run.pr_url)
        return {"url": run.pr_url}


@app.get("/api/runs/{identity}/report")
def report(identity: str, request: Request, format: Literal["md", "json"] = "md"):
    data = run_detail(identity, request)
    if format == "json":
        body = json.dumps(data, ensure_ascii=False, indent=2)
        media = "application/json"
    else:
        body = f"# {identity}\n\n状态: {data['status']}\n\n事件哈希链校验: {data['hash_valid']}\n\n分支: {data['branch']}\n\nCommit: {data['commit_sha'] or '尚未提交'}\n\nPR: {data['pr_url'] or '尚未创建'}\n\n## 完整记录\n\n```json\n{json.dumps(data, ensure_ascii=False, indent=2)}\n```\n"
        media = "text/markdown"
    audit("report_exported", actor(request), run_id=identity, format=format)
    return Response(
        body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{identity}.{format}"'},
    )


@app.get("/api/audit")
def audit_log(request: Request):
    require_login(request)
    return all_items(Audit)[::-1]


@app.get("/api/audit/export")
def audit_export(request: Request):
    require_login(request)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["time", "actor", "action", "detail"])
    for row in all_items(Audit):
        writer.writerow(
            [
                row.created,
                row.actor,
                row.action,
                json.dumps(row.detail, ensure_ascii=False),
            ]
        )
    return Response(
        "\ufeff" + output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit.csv"'},
    )


class PreferencesInput(BaseModel):
    llm_base_url: str
    llm_model: str
    # Empty keeps the saved key; it is never returned by GET /settings.
    llm_api_key: str = Field(default="", max_length=500)
    workspace_dir: str
    default_permission: Literal["readonly", "approve", "auto", "full"] = "approve"
    full_confirmed: bool = False
    bash_allow: list[str] = Field(default_factory=list)
    bash_deny: list[str] = Field(default_factory=list)
    sync_mode: Literal["incremental", "full"] = "incremental"
    auto_sync_enabled: bool = False
    auto_sync_interval: int = Field(default=60, ge=5, le=1440)
    # A part that is absent sends no effort and the model decides.
    reasoning_effort: dict[
        Literal["review", "plan", "ask", "agent"],
        Literal["low", "medium", "high", "xhigh", "max"],
    ] = Field(default_factory=dict)

    @field_validator("bash_allow", "bash_deny")
    @classmethod
    def valid_patterns(cls, patterns):
        return RunConfig.valid_patterns(patterns)

    @model_validator(mode="after")
    def full_sync_is_not_frequent(self):
        if (
            self.auto_sync_enabled
            and self.sync_mode == "full"
            and self.auto_sync_interval < 60
        ):
            raise ValueError("自动全量同步的间隔不能少于 60 分钟")
        return self


def safe_llm_url(url):
    """The LLM endpoint is where the API key travels, so it cannot be an
    arbitrary URL: https is required, and http is kept only for a
    loop-back address (a local model server)."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    try:
        address = ipaddress.ip_address(host) if host else None
    except ValueError:
        address = None
    loopback = host in ("127.0.0.1", "localhost", "::1") or bool(
        address and address.is_loopback
    )
    if parsed.scheme not in ("http", "https") or not host:
        raise HTTPException(422, "LLM Base URL 必须为有效的 http(s) 地址")
    if parsed.username or parsed.password:
        raise HTTPException(422, "LLM Base URL 不能包含用户名密码")
    if parsed.scheme == "http" and not loopback:
        raise HTTPException(422, "LLM Base URL 必须为 https，仅本地回环允许 http")
    if address is not None and not loopback and address.is_private:
        raise HTTPException(422, "LLM Base URL 不能指向内网地址")
    return url.strip()


@app.get("/api/settings")
def read_settings(request: Request):
    # The full response reveals where tokens live and which tools the host
    # runs. A guest gets only what its pages need to render correctly.
    payload = settings_payload()
    if request.session.get("user"):
        return payload
    return {key: payload[key] for key in GUEST_SETTINGS}


GUEST_SETTINGS = (
    "llm_configured",
    "sync_mode",
    "auto_sync_enabled",
    "auto_sync_interval",
    "max_steps",
    "max_tokens",
)


def settings_payload():
    pref = preferences()
    return {
        "llm_base_url": pref.get("llm_base_url", DEFAULT_LLM_BASE_URL),
        "llm_model": pref.get("llm_model", ""),
        "llm_configured": bool(llm_api_key()),
        "workspace_dir": pref.get("workspace_dir", settings.workspace_dir),
        "default_permission": pref.get(
            "default_permission", settings.agent_default_permission
        ),
        "bash_allow": pref.get("bash_allow", []),
        "bash_deny": pref.get("bash_deny", []),
        "sync_mode": pref.get("sync_mode", "incremental"),
        "auto_sync_enabled": pref.get("auto_sync_enabled", False),
        "auto_sync_interval": pref.get("auto_sync_interval", 60),
        "reasoning_effort": pref.get("reasoning_effort", {}),
        "max_steps": settings.agent_max_steps,
        "command_timeout": settings.agent_command_timeout_seconds,
        "max_tokens": settings.agent_max_tokens,
        "tools": {
            name: bool(shutil.which(bin))
            for name, bin in [
                ("git", "git"),
                ("codegraph", settings.codegraph_bin),
                ("bandit", settings.bandit_bin),
                ("semgrep", settings.semgrep_bin),
            ]
        },
        "database": "SQLite"
        if settings.database_url.startswith("sqlite")
        else "PostgreSQL",
    }


@app.put("/api/settings")
def write_settings(body: PreferencesInput, request: Request):
    require_login(request, "修改设置需要 GitHub 登录")
    body.llm_base_url = safe_llm_url(body.llm_base_url)
    if body.default_permission == "full" and not body.full_confirmed:
        raise HTTPException(422, "完全权限需要确认")
    values = body.model_dump(exclude={"full_confirmed", "llm_api_key"})
    key = body.llm_api_key.strip()
    saved_key = preferences().get("llm_api_key_enc")
    if key:
        values["llm_api_key_enc"] = fernet.encrypt(key.encode()).decode()
    elif saved_key:
        values["llm_api_key_enc"] = saved_key
    upsert(Preference(values=values))
    audit("settings_saved", actor(request), llm_key_changed=bool(key))
    return settings_payload()


@app.post("/api/settings/test")
async def test_connection(request: Request):
    # Sends a real call paid for by the host key to a configured endpoint.
    require_login(request, "测试 LLM 连接需要 GitHub 登录")
    start = time.monotonic()
    result = await ask("仅回复 OK", actor=actor(request))
    return {
        "ok": True,
        "latency_ms": round((time.monotonic() - start) * 1000),
        "tokens": result["tokens"],
    }


# The console calls the handlers above as its tools, so it is added last.
from .console import router as console_router  # noqa: E402

app.include_router(console_router)
