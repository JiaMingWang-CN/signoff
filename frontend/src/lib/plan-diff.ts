import type { Scheduled } from "../api";

export type Placement = Pick<Scheduled, "date" | "who" | "hours">;
export type ChangeKind = "date" | "who" | "hours";
export type TaskChange = {
  id: string;
  title: string;
  kind: ChangeKind;
  before: Placement[];
  after: Placement[];
  // Where the task used to be and no longer is, so the calendar can ghost it.
  removedFrom: Scheduled[];
};

const signature = (p: Placement) => p.date + "|" + p.who + "|" + p.hours;
const byDate = (a: Scheduled, b: Scheduled) => a.date.localeCompare(b.date);
const place = (t: Scheduled): Placement => ({
  date: t.date,
  who: t.who,
  hours: t.hours,
});

// Per-task difference between two calendars. A task counts as changed when its
// list of (day, who, hours) placements differs — moving a day, changing who does
// it, or only shifting some of its hours between days.
export function diffCalendars(
  before: Scheduled[],
  after: Scheduled[],
): TaskChange[] {
  const ids = [...new Set([...before, ...after].map((t) => t.id))];
  const changes: TaskChange[] = [];
  for (const id of ids) {
    const b = before.filter((t) => t.id === id).sort(byDate);
    const a = after.filter((t) => t.id === id).sort(byDate);
    if (b.map(signature).join(",") === a.map(signature).join(",")) continue;
    // Same start day with different hours means the work was only redistributed.
    const startMoved = b[0]?.date !== a[0]?.date;
    const afterSet = new Set(a.map((t) => t.date));
    changes.push({
      id,
      title: (a[0] || b[0]).title,
      kind:
        [...new Set(b.map((t) => t.who))].sort().join() !==
        [...new Set(a.map((t) => t.who))].sort().join()
          ? "who"
          : startMoved
            ? "date"
            : "hours",
      before: b.map(place),
      after: a.map(place),
      removedFrom: b.filter((t) => !afterSet.has(t.date)),
    });
  }
  return changes;
}

export const kindText: Record<ChangeKind, string> = {
  date: "日期调整",
  who: "执行方变化",
  hours: "工时重新分配",
};

export function formatPlacements(list: Placement[]) {
  return list.length
    ? list
        .map(
          (p) =>
            p.date.slice(5) +
            " " +
            (p.who === "human" ? "人" : "Agent") +
            " " +
            p.hours +
            "h",
        )
        .join("、")
    : "—";
}
