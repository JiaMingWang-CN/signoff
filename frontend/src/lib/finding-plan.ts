import type { Plan } from "../api";

export type PlanLink = {
  task: string;
  title: string;
  // First scheduled day; empty while the task is only in a drafted plan.
  date: string;
  scheduled: boolean;
};

// Findings are referenced from a task's text as "SEC-5", or as a range such as
// "SEC-9~SEC-11" / "SEC-64 至 SEC-91".
export function findingRefs(text: string): string[] {
  const ids = new Set<string>();
  const pattern = /SEC-(\d+)(?:\s*(?:~|～|-|–|—|至|到)\s*(?:SEC-)?(\d+))?/gi;
  for (const match of text.matchAll(pattern)) {
    const from = Number(match[1]);
    const end = match[2] ? Number(match[2]) : from;
    // A reversed or absurdly long range is not trusted: keep only its first id.
    const to = end >= from && end - from <= 500 ? end : from;
    for (let n = from; n <= to; n++) ids.add("SEC-" + n);
  }
  return [...ids];
}

// Which tasks pick up which findings. The applied plan is what is on the
// calendar; a newer plan that was only drafted still shows its tasks, marked as
// not yet scheduled. Plans are newest first, as the API returns them.
export function findingPlanLinks(plans: Plan[]): Map<string, PlanLink[]> {
  const links = new Map<string, PlanLink[]>();
  const applied = plans.find((p) => p.status === "applied");
  const appliedIndex = applied ? plans.indexOf(applied) : plans.length;
  const draft = plans
    .slice(0, appliedIndex)
    .find((p) => p.status !== "preview" && p.status !== "applied");
  const add = (plan: Plan | undefined, scheduled: boolean) => {
    for (const task of plan?.tasks || []) {
      const date =
        plan!.calendar
          .filter((t) => t.id === task.id)
          .map((t) => t.date)
          .sort()[0] || "";
      for (const id of findingRefs(task.src + " " + task.title)) {
        const list = links.get(id) || [];
        if (!list.some((l) => l.task === task.id))
          list.push({ task: task.id, title: task.title, date, scheduled });
        links.set(id, list);
      }
    }
  };
  add(applied, true);
  // A drafted plan only adds findings the applied one does not already cover.
  const covered = new Set(links.keys());
  if (draft) {
    const before = new Map(links);
    add(draft, false);
    for (const id of covered) links.set(id, before.get(id)!);
  }
  return links;
}
