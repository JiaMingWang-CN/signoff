// Verifies the scanning state on 漏洞分析: after "开始扫描" the page switches to
// "scanning" at once (not after the next poll), shows stage progress and the
// growing finding count, then returns to normal. All API calls are mocked.
// Serve a build first:  VITE_PORT=5199 npx vite preview   (override with FIT_BASE)
import { launch } from "./launch.mjs";
import assert from "node:assert/strict";

const base = process.env.FIT_BASE || "http://127.0.0.1:5199";
const repo = {
  id: "repo-scan",
  name: "owner/demo",
  source: "github",
  path: "/work/demo",
  branch: "main",
  sha: "abcdef1234",
  status: "ready",
  error: "",
  updated: "2026-10-01T00:00:00Z",
  syncing: false,
  issues_synced: "",
  last_sync: {},
  issues: [],
  progress: [],
  stats: { file_count: 3, languages: { ".py": 3 } },
};
const finding = (n) => ({
  id: "SEC-" + n,
  title: "问题 " + n,
  severity: "high",
  source: "内置规则",
  rule: "r",
  file: "a.py",
  line: n,
  code: "x",
  suggestion: "fix",
  review: "未复核",
  status: "open",
});
const old = {
  id: "scan-old",
  status: "complete",
  findings: [finding(1)],
  sources: [{ name: "内置规则", status: "complete" }],
  error: "",
  sha: "abcdef1234",
  created: "2026-09-30T00:00:00Z",
};
const fresh = { ...old, id: "scan-new", status: "running", findings: [], sources: [], created: "2026-10-01T00:00:00Z" };

// What the server reports on each poll after the scan starts.
const polls = [
  { ...fresh },
  { ...fresh, findings: [finding(1), finding(2)], sources: [{ name: "内置规则", status: "complete" }] },
  {
    ...fresh,
    status: "complete",
    findings: [finding(1), finding(2), finding(3)],
    sources: [
      { name: "内置规则", status: "complete" },
      { name: "OSV.dev", status: "complete" },
      { name: "bandit", status: "skipped", reason: "未安装" },
      { name: "semgrep", status: "skipped", reason: "未安装" },
    ],
  },
];

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((id) => localStorage.setItem("ow-repo", id), repo.id);
  await page.route("**/api/repos", (r) => r.fulfill({ json: [repo] }));
  await page.route("**/api/auth/me", (r) =>
    r.fulfill({ json: { user: null, demo_repo: repo.name, oauth_configured: false } }),
  );
  await page.route("**/api/settings", (r) =>
    r.fulfill({
      json: {
        llm_base_url: "", llm_model: "", llm_configured: false, workspace_dir: "",
        default_permission: "approve", bash_allow: [], bash_deny: [], max_steps: 40,
        command_timeout: 300, max_tokens: 200000, tools: {}, database: "SQLite",
      },
    }),
  );
  await page.route("**/api/repos/*/plans", (r) => r.fulfill({ json: [] }));
  let started = false;
  let served = 0;
  await page.route("**/api/repos/*/scans", (route) => {
    if (route.request().method() === "POST") {
      started = true;
      return route.fulfill({ json: fresh });
    }
    if (!started) return route.fulfill({ json: [old] });
    const current = polls[Math.min(served++, polls.length - 1)];
    return route.fulfill({ json: [current, old] });
  });

  await page.goto(base + "/security");
  await page.getByRole("button", { name: "开始扫描" }).waitFor();
  await page.getByRole("button", { name: "开始扫描" }).click();

  // At once: the button says scanning and the progress panel is up.
  const scanning = page.getByRole("button", { name: /扫描中/ });
  await scanning.waitFor();
  assert.ok(await scanning.isDisabled(), "scan button is disabled while scanning");
  const panel = page.locator(".scan-progress");
  await panel.waitFor();
  assert.match(await panel.innerText(), /正在扫描/);
  assert.match(await panel.innerText(), /内置规则[\s\S]*进行中/, "first stage is running");
  assert.match(await page.locator(".card-foot").first().innerText(), /扫描中/, "count is marked as growing");

  // Later polls: the count grows and the first stage completes.
  await page.getByText("已发现 2 条").waitFor({ timeout: 8000 });
  assert.match(await panel.innerText(), /OSV\.dev[\s\S]*进行中/, "next stage is running");

  // Finally: back to normal, panel gone, button usable again.
  await panel.waitFor({ state: "detached", timeout: 8000 });
  await page.getByRole("button", { name: "开始扫描" }).waitFor();
  assert.ok(await page.getByRole("button", { name: "开始扫描" }).isEnabled());
  assert.match(await page.locator(".card-foot").first().innerText(), /共 3 条/);
  assert.deepEqual(errors, []);
  console.log("Scan progress verified: immediate scanning state, stages, growing count, completion.");
} finally {
  await browser.close();
}
