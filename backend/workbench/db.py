import json
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import JSON, Column, Index, func, inspect, text
from sqlmodel import Field, Session, SQLModel, create_engine, select
from pydantic import computed_field

from .config import ROOT, settings


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return prefix + "-" + uuid4().hex[:12]


class Repository(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uid("repo"), primary_key=True)
    name: str
    path: str
    source: str = "github"
    status: str = "importing"
    error: str = ""
    branch: str = ""
    sha: str = ""
    stats: dict = Field(default_factory=dict, sa_column=Column(JSON))
    progress: list = Field(default_factory=list, sa_column=Column(JSON))
    issues: list = Field(default_factory=list, sa_column=Column(JSON))
    updated: str = Field(default_factory=now)
    # Issue sync bookkeeping: baseline for incremental sync, whether a sync is
    # running, what the last one did, and which stored login auto-sync may use.
    issues_synced: str = ""
    syncing: bool = False
    last_sync: dict = Field(default_factory=dict, sa_column=Column(JSON))
    token_id: str = ""

    @computed_field
    @property
    def demo(self) -> bool:
        return self.source == "github" and self.name.lower() == settings.demo_repo.lower()


class Scan(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uid("scan"), primary_key=True)
    repo_id: str = Field(index=True)
    actor: str = Field(default="", index=True)
    status: str = "running"
    findings: list = Field(default_factory=list, sa_column=Column(JSON))
    sources: list = Field(default_factory=list, sa_column=Column(JSON))
    error: str = ""
    sha: str = ""
    created: str = Field(default_factory=now)


class Plan(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uid("plan"), primary_key=True)
    repo_id: str = Field(index=True)
    actor: str = Field(default="", index=True)
    tasks: list = Field(default_factory=list, sa_column=Column(JSON))
    capacity: dict = Field(default_factory=dict, sa_column=Column(JSON))
    calendar: list = Field(default_factory=list, sa_column=Column(JSON))
    summary: str = ""
    status: str = "draft"
    version: int = 1
    created: str = Field(default_factory=now)


class Run(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uid("run"), primary_key=True)
    repo_id: str = Field(index=True)
    task: dict = Field(default_factory=dict, sa_column=Column(JSON))
    config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    status: str = "starting"
    path: str = ""
    branch: str = ""
    base_sha: str = ""
    commit_sha: str = ""
    diff: str = ""
    tests: dict = Field(default_factory=dict, sa_column=Column(JSON))
    tokens: int = 0
    error: str = ""
    pr_url: str = ""
    created: str = Field(default_factory=now)
    finished: str = ""
    actor: str = ""
    quota_actor: str = ""
    __table_args__ = (Index("ix_run_actor_created", "actor", "created"),)


class Event(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    run_id: str = Field(index=True)
    kind: str
    data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created: str = Field(default_factory=now)
    prev_hash: str = ""
    hash: str = ""


class Audit(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    action: str
    actor: str
    detail: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created: str = Field(default_factory=now)
    __table_args__ = (Index("ix_audit_actor_created", "actor", "created"),)


class Conversation(SQLModel, table=True):
    """A console chat: the model-format message list, the operation waiting
    for the user's approval, and the tools the user allowed for the rest of it."""

    id: str = Field(default_factory=lambda: uid("chat"), primary_key=True)
    actor: str = Field(index=True)
    quota_actor: str = Field(default="", index=True)
    title: str = ""
    permission: str = "approve"
    # Reasoning effort chosen in the console; empty follows the "ask" setting.
    effort: str = ""
    # The repository selected in the page when the user last wrote.
    repo_id: str = ""
    status: str = "idle"
    messages: list = Field(default_factory=list, sa_column=Column(JSON))
    pending: dict = Field(default_factory=dict, sa_column=Column(JSON))
    allowed: list = Field(default_factory=list, sa_column=Column(JSON))
    error: str = ""
    tokens: int = 0
    created: str = Field(default_factory=now)
    updated: str = Field(default_factory=now)


class Token(SQLModel, table=True):
    id: str = Field(primary_key=True)
    encrypted: str
    expires: float = 0


class Preference(SQLModel, table=True):
    id: str = Field(default="settings", primary_key=True)
    values: dict = Field(default_factory=dict, sa_column=Column(JSON))


database_url = settings.database_url
if database_url.startswith("sqlite:///./"):
    database_url = (
        "sqlite:///" + (ROOT / database_url.removeprefix("sqlite:///./")).as_posix()
    )
if database_url.startswith("sqlite:///"):
    Path(database_url.removeprefix("sqlite:///")).parent.mkdir(
        parents=True, exist_ok=True
    )
engine = create_engine(
    database_url,
    connect_args={"check_same_thread": False, "timeout": 30}
    if database_url.startswith("sqlite")
    else {},
)


def column_default(model, name):
    """SQL DEFAULT literal matching the model's Python default for a column."""
    field = model.model_fields[name]
    value = field.default_factory() if field.default_factory else field.default
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, dict):
        return "'{}'"
    if isinstance(value, list):
        return "'[]'"
    return "NULL"


def ensure_columns(target=None):
    """Add columns introduced after a database was first created."""
    target = target or engine
    inspector = inspect(target)
    # Every table model, so a new table cannot be forgotten here.
    models = {
        m.class_.__tablename__: m.class_
        for m in SQLModel._sa_registry.mappers
        if hasattr(m.class_, "model_fields")
    }
    with target.begin() as connection:
        for table in SQLModel.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                connection.exec_driver_sql(
                    f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" '
                    f"{column.type.compile(target.dialect)} "
                    f"DEFAULT {column_default(models[table.name], column.name)}"
                )


def initialize():
    SQLModel.metadata.create_all(engine)
    ensure_columns()
    if database_url.startswith("sqlite"):
        with engine.begin() as connection:
            connection.exec_driver_sql("PRAGMA journal_mode=WAL")
            connection.exec_driver_sql(
                "CREATE VIRTUAL TABLE IF NOT EXISTS issue_fts USING fts5(repo_id UNINDEXED, number UNINDEXED, title, body, labels, comments)"
            )
    with Session(engine) as session:
        for run in session.exec(
            select(Run).where(Run.status.in_(["starting", "running", "waiting"]))
        ).all():
            run.status = "interrupted"
            run.error = "服务重启中断了此运行，请创建新运行。"
            run.finished = now()
            session.add(run)
        for repo in session.exec(
            select(Repository).where(Repository.status == "importing")
        ).all():
            repo.status = "error"
            repo.error = "导入被服务重启中断，请重新同步。"
            session.add(repo)
        for repo in session.exec(
            select(Repository).where(Repository.syncing == True)
        ).all():
            repo.syncing = False
            session.add(repo)
        for scan in session.exec(select(Scan).where(Scan.status == "running")).all():
            scan.status = "error"
            scan.error = "扫描被服务重启中断，请重试。"
            session.add(scan)
        for chat in session.exec(
            select(Conversation).where(Conversation.status == "running")
        ).all():
            chat.status = "idle"
            chat.error = "服务重启中断了这次回复，请重新发送。"
            session.add(chat)
        session.commit()
    # A crash between saving issues and rebuilding the FTS5 index would leave
    # search stale with no other symptom; repair any mismatch at startup.
    for repo in all_items(Repository):
        if repo.issues and (fts_count(repo.id) or 0) != len(repo.issues):
            index_issues(repo)


def get(model, identity):
    with Session(engine) as session:
        item = session.get(model, identity)
        if not item:
            from fastapi import HTTPException

            raise HTTPException(404, "记录不存在")
        return item


def save(item):
    from sqlalchemy.orm.attributes import flag_modified

    for name in type(item).model_fields:
        if isinstance(getattr(item, name), (dict, list)):
            flag_modified(item, name)
    with Session(engine) as session:
        session.add(item)
        session.commit()
        session.refresh(item)
    return item


def upsert(item):
    """Insert, or replace the row that has the same primary key."""
    with Session(engine) as session:
        merged = session.merge(item)
        session.commit()
        session.refresh(merged)
        session.expunge(merged)
    return merged


def all_items(model, **filters):
    with Session(engine) as session:
        query = select(model)
        for key, value in filters.items():
            query = query.where(getattr(model, key) == value)
        if hasattr(model, "created"):
            query = query.order_by(model.created, model.id)
        elif hasattr(model, "updated"):
            query = query.order_by(model.updated, model.id)
        else:
            query = query.order_by(model.id)
        return list(session.exec(query).all())


def delete_items(model, **filters):
    """Delete every row matching the filters; returns how many were removed."""
    with Session(engine) as session:
        query = select(model)
        for key, value in filters.items():
            query = query.where(getattr(model, key) == value)
        rows = list(session.exec(query).all())
        for row in rows:
            session.delete(row)
        session.commit()
    return len(rows)


def audit(action, actor="local", **detail):
    save(Audit(action=action, actor=actor, detail=detail))


def count_items(model, **filters):
    """Count rows without loading them (guest quotas and usage scans).

    A key ending in __startswith matches a prefix, which keeps the check
    on the (actor, created) index instead of scanning a whole year."""
    with Session(engine) as session:
        query = select(func.count()).select_from(model)
        for key, value in filters.items():
            column = getattr(model, key.replace("__startswith", ""))
            if key.endswith("__startswith"):
                query = query.where(column.like(value + "%"))
            else:
                query = query.where(column == value)
        return int(session.exec(query).one())


def sum_audit_detail(actor, action, key, day_prefix):
    """Sum a numeric detail key over one day's audit rows for an actor.

    Uses an index on (actor, created); the Audit table grows with every LLM
    call, so a filtered aggregate stays fast while all_items() would not.
    """
    with Session(engine) as session:
        rows = session.exec(
            select(Audit.detail)
            .where(
                Audit.actor == actor,
                Audit.action == action,
                Audit.created.startswith(day_prefix),
            )
            .order_by(Audit.id)
        ).all()
        return sum(int((row or {}).get(key, 0)) for row in rows)


def events_after(run_id, cursor, limit=200):
    """Events newer than an id, oldest first."""
    with Session(engine) as session:
        return list(
            session.exec(
                select(Event)
                .where(Event.run_id == run_id, Event.id > cursor)
                .order_by(Event.id)
                .limit(limit)
            ).all()
        )


def last_event(run_id):
    """The newest event of a run, or None. Ordering by id keeps the chain
    sequence even when two events share a timestamp."""
    with Session(engine) as session:
        return session.exec(
            select(Event).where(Event.run_id == run_id).order_by(Event.id.desc())
        ).first()


def fts_count(repo_id):
    """Number of rows in the FTS5 index for a repo (None when FTS is unused)."""
    if not database_url.startswith("sqlite"):
        return None
    with engine.begin() as connection:
        row = connection.exec_driver_sql(
            "SELECT COUNT(*) FROM issue_fts WHERE repo_id = ?", (repo_id,)
        ).fetchone()
        return int(row[0]) if row else 0


def index_issues(repo):
    if not database_url.startswith("sqlite"):
        return
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "DELETE FROM issue_fts WHERE repo_id = ?", (repo.id,)
        )
        for issue in repo.issues:
            connection.exec_driver_sql(
                "INSERT INTO issue_fts VALUES (?,?,?,?,?,?)",
                (
                    repo.id,
                    str(issue["number"]),
                    issue["title"],
                    issue.get("body") or "",
                    json.dumps(issue.get("labels", []), ensure_ascii=False),
                    issue.get("comments_text", ""),
                ),
            )


def find_issues(repo, query, state="all", label=""):
    """Full-text search over a repository's synced issues (FTS5 on SQLite)."""
    ids = None
    if database_url.startswith("sqlite"):
        tokens = re.findall(r"[\w\u4e00-\u9fff]+", query)
        if tokens:
            match = " OR ".join('"' + t + '"' for t in tokens)
            with engine.connect() as connection:
                ids = {
                    int(row[0])
                    for row in connection.execute(
                        text(
                            "SELECT number FROM issue_fts WHERE repo_id=:repo AND issue_fts MATCH :match"
                        ),
                        {"repo": repo.id, "match": match},
                    )
                }
                # unicode61 groups contiguous Chinese text into one token.
                # Add literal substring matches per word, without
                # interpolating SQL.
                for word in (t for t in tokens if re.search(r"[\u4e00-\u9fff]", t)):
                    pattern = (
                        "%"
                        + word.replace("\\", "\\\\")
                        .replace("%", "\\%")
                        .replace("_", "\\_")
                        + "%"
                    )
                    ids.update(
                        int(row[0])
                        for row in connection.execute(
                            text(
                                "SELECT number FROM issue_fts WHERE repo_id=:repo AND (title LIKE :pattern ESCAPE '\\' OR body LIKE :pattern ESCAPE '\\' OR labels LIKE :pattern ESCAPE '\\' OR comments LIKE :pattern ESCAPE '\\')"
                            ),
                            {"repo": repo.id, "pattern": pattern},
                        )
                    )
    return [
        i
        for i in repo.issues
        if (
            ids is None
            and query.lower() in json.dumps(i, ensure_ascii=False).lower()
            or ids is not None
            and i["number"] in ids
        )
        and (state == "all" or i["state"] == state)
        and (not label or label in i["labels"])
    ]
