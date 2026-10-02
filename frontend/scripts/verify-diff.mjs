// Unit checks for the calendar diff used by the adjust preview and for the
// finding → task links on the security page.
// Run with Node >= 22.18 (it loads the TypeScript source directly).
import assert from "node:assert/strict";
import { diffCalendars, formatPlacements } from "../src/lib/plan-diff.ts";
import { findingPlanLinks, findingRefs } from "../src/lib/finding-plan.ts";

const t = (id, date, hours, who = "agent") => ({
  id,
  title: id + " 任务",
  why: "",
  src: "",
  dep: "—",
  h: 2,
  who,
  priority: 1,
  date,
  hours,
});

// T9's second hour moves forward because earlier work left the day: same day
// still holds it, but its hours changed, and Monday no longer has it.
const before = [
  t("T5", "2026-10-02", 2),
  t("T9", "2026-10-02", 1),
  t("T9", "2026-10-05", 1),
  t("T1", "2026-10-01", 2),
];
const after = [
  t("T5", "2026-10-03", 2),
  t("T9", "2026-10-02", 2),
  t("T1", "2026-10-01", 2),
];
const changes = diffCalendars(before, after);
assert.deepEqual(
  changes.map((c) => [c.id, c.kind]),
  [
    ["T5", "date"],
    ["T9", "hours"],
  ],
  "T1 is untouched; T5 moved; T9 only redistributed",
);
const t9 = changes.find((c) => c.id === "T9");
assert.equal(formatPlacements(t9.before), "10-02 Agent 1h、10-05 Agent 1h");
assert.equal(formatPlacements(t9.after), "10-02 Agent 2h");
assert.deepEqual(
  t9.removedFrom.map((x) => x.date),
  ["2026-10-05"],
  "only the day that no longer holds T9 is ghosted",
);
assert.deepEqual(
  changes.find((c) => c.id === "T5").removedFrom.map((x) => x.date),
  ["2026-10-02"],
);
assert.equal(
  diffCalendars([t("T3", "2026-10-01", 1)], [t("T3", "2026-10-02", 1, "human")])[0].kind,
  "who",
);
assert.deepEqual(diffCalendars(before, before), []);

// Finding references: single ids, ranges in several spellings, and no false hits.
assert.deepEqual(findingRefs("Issue #1; SEC-5 (app/search.py:18)"), ["SEC-5"]);
assert.deepEqual(findingRefs("SEC-9~SEC-11"), ["SEC-9", "SEC-10", "SEC-11"]);
assert.deepEqual(findingRefs("SEC-64 至 SEC-66, SEC-2"), ["SEC-64", "SEC-65", "SEC-66", "SEC-2"]);
assert.deepEqual(findingRefs("SEC-2 - 硬编码密钥"), ["SEC-2"]);
assert.deepEqual(findingRefs("SEC-9~3"), ["SEC-9"], "a reversed range is ignored");
assert.deepEqual(findingRefs("没有引用"), []);

// Links: the applied plan wins and carries the first scheduled day; a drafted
// plan only adds findings the applied one does not cover, as not scheduled.
const task = (id, src) => ({ id, title: id + " 任务", why: "", src, dep: "—", h: 1, who: "agent", priority: 1 });
const plan = (status, tasks, calendar = []) => ({ id: status, tasks, calendar, status, capacity: {}, summary: "", version: 1, created: "" });
const links = findingPlanLinks([
  plan("draft", [task("T1", "SEC-5"), task("T2", "SEC-7")]),
  plan("applied", [task("T1", "SEC-5")], [t("T1", "2026-10-03", 1), t("T1", "2026-10-02", 1)]),
]);
assert.deepEqual(links.get("SEC-5"), [{ task: "T1", title: "T1 任务", date: "2026-10-02", scheduled: true }]);
assert.deepEqual(links.get("SEC-7"), [{ task: "T2", title: "T2 任务", date: "", scheduled: false }]);
assert.equal(links.has("SEC-9"), false);
assert.equal(findingPlanLinks([]).size, 0);
console.log("verified: calendar diff, finding references and plan links.");
