from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Task(BaseModel):
    id: str
    title: str
    why: str = ""
    src: str = ""
    dep: str = "—"
    h: float = Field(gt=0, le=1000)
    who: Literal["human", "agent"] = "agent"
    priority: int = Field(default=2, ge=0, le=4)
    not_before: date | None = None
    # Pin to exactly this day, even when it is a rest day. Dependencies still win.
    on: date | None = None


class Capacity(BaseModel):
    hours: float = Field(default=4, gt=0, le=24)
    concurrency: int = Field(default=2, ge=1, le=8)
    start: date = Field(default_factory=date.today)
    weekdays: list[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5])
    blocked: list[date] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_days(self):
        if not self.weekdays or any(d < 0 or d > 6 for d in self.weekdays):
            raise ValueError("请选择有效的工作日")
        return self


class PlanInput(BaseModel):
    tasks: list[Task] = Field(min_length=1, max_length=100)
    capacity: Capacity = Field(default_factory=Capacity)


def schedule(tasks: list[Task], capacity: Capacity):
    ids = [t.id for t in tasks]
    if len(set(ids)) != len(ids):
        raise ValueError("任务编号重复")

    def working(day):
        return (day.weekday() + 1) % 7 in capacity.weekdays and day not in capacity.blocked

    used = {}
    end = {}
    result = []
    pending = sorted(tasks, key=lambda t: t.priority)
    while pending:
        task = next((t for t in pending if t.dep in ("", "—") or t.dep in end), None)
        if task is None:
            raise ValueError("任务依赖存在循环或缺失")
        pending.remove(task)
        remaining = task.h
        first = capacity.start
        if task.dep not in ("", "—"):
            first = max(first, end[task.dep] + timedelta(days=1))
        if task.not_before:
            first = max(first, task.not_before)
        # A pinned task may take its day even if that day is a rest day; any
        # hours that do not fit continue on the following working days.
        pinned = task.on if task.on and task.on >= first else None
        if pinned:
            first = pinned
        for offset in range(730):
            day = first + timedelta(days=offset)
            if remaining <= 0:
                break
            if not (working(day) or (day == pinned and day not in capacity.blocked)):
                continue
            key = (task.who, day)
            limit = capacity.hours if task.who == "human" else 4 * capacity.concurrency
            hours = min(
                remaining,
                capacity.hours if task.who == "human" else 4,
                limit - used.get(key, 0),
            )
            if hours > 0:
                result.append(
                    {
                        **task.model_dump(mode="json"),
                        "date": day.isoformat(),
                        "hours": hours,
                    }
                )
                used[key] = used.get(key, 0) + hours
                remaining -= hours
                end[task.id] = day
        if remaining > 0:
            raise ValueError("两年内没有足够的可用时间")
    return result
