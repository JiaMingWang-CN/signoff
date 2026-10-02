// Verifies the sync controls: one "同步" button whose mode comes from settings,
// the last-sync summary, and the sync settings. All API calls are mocked.
// Serve a build first:  VITE_PORT=5199 npx vite preview   (override with FIT_BASE)
import { launch } from "./launch.mjs";
import assert from "node:assert/strict";

const base = process.env.FIT_BASE || "http://127.0.0.1:5199";
const baseRepo = {
  id: "repo-sync",
  name: "owner/demo",
  source: "github",
  path: "/work/demo",
  branch: "main",
  sha: "abcdef1234",
  status: "ready",
  error: "",
  updated: "2026-10-01T00:00:00Z",
  syncing: false,
  issues_synced: "2026-10-01T00:00:00Z",
  last_sync: {
    mode: "incremental",
    requested: "incremental",
    trigger: "auto",
    at: "2026-10-01T01:00:00Z",
    added: 2,
    updated: 5,
    removed: 0,
    total: 30,
    error: "",
  },
  issues: [],
  progress: [],
  stats: { file_count: 3, languages: { ".py": 3 } },
};
const baseSettings = {
  llm_base_url: "https://x/v1",
  llm_model: "m",
  llm_configured: true,
  workspace_dir: "/w",
  default_permission: "approve",
  bash_allow: [],
  bash_deny: [],
  sync_mode: "incremental",
  auto_sync_enabled: false,
  auto_sync_interval: 30,
  max_steps: 40,
  command_timeout: 300,
  max_tokens: 200000,
  tools: {},
  database: "SQLite",
};


const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let repo = baseRepo;
  let settings = baseSettings;
  const syncBodies = [];
  const savedSettings = [];
  await page.addInitScript((id) => localStorage.setItem("ow-repo", id), repo.id);
  await page.route("**/api/repos", (r) => r.fulfill({ json: [repo] }));
  await page.route("**/api/repos/*/scans", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/repos/*/plans", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/repos/*/runs", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/auth/me", (r) =>
    r.fulfill({ json: { user: { login: "me", avatar_url: "", html_url: "" }, demo_repo: repo.name, oauth_configured: true } }),
  );
  await page.route("**/api/settings", (r) => {
    if (r.request().method() === "PUT") {
      const body = r.request().postDataJSON();
      savedSettings.push(body);
      settings = { ...settings, ...body };
    }
    return r.fulfill({ json: settings });
  });
  await page.route("**/api/repos/*/sync", (r) => {
    syncBodies.push(r.request().postDataJSON());
    return r.fulfill({ json: { ...repo, syncing: true } });
  });

  // ── overview: a single sync button; the mode comes from settings ──
  await page.goto(base + "/overview");
  const button = page.getByRole("button", { name: "同步", exact: true });
  await button.waitFor();
  assert.equal(await button.count(), 1, "exactly one sync button");
  assert.equal(await page.getByRole("button", { name: /增量同步|全量同步/ }).count(), 0, "mode buttons are gone");
  const status = await page.locator(".sync-status").innerText();
  assert.match(status, /上次同步 · 增量 · 自动/);
  assert.match(status, /新增 2 · 更新 5 · 删除 0 · 共 30 个 Issue/);
  assert.match(status, /同步方式：增量/);
  assert.match(status, /自动同步：未开启/);
  await button.click();
  await page.waitForTimeout(200);
  assert.deepEqual(syncBodies, [{}], "the client leaves the mode to the server's settings");

  // ── overview: syncing disables the button; failure and fallback are shown ──
  repo = { ...baseRepo, syncing: true };
  await page.goto(base + "/overview");
  const busy = page.getByRole("button", { name: "同步中…" });
  await busy.waitFor();
  assert.equal(await busy.count(), 1);
  assert.ok(await busy.isDisabled());
  repo = {
    ...baseRepo,
    last_sync: { ...baseRepo.last_sync, mode: "full", requested: "incremental", fell_back: true, trigger: "manual", error: "network down" },
  };
  await page.goto(base + "/overview");
  const failed = await page.locator(".sync-status").innerText();
  assert.match(failed, /全量（无基线，已回退为全量）\s*·\s*手动/);
  assert.match(failed, /最近一次同步失败：network down/);
  repo = { ...baseRepo, source: "local", last_sync: { mode: "code", trigger: "manual", at: "2026-10-01T01:00:00Z" } };
  await page.goto(base + "/overview");
  assert.equal(await page.getByRole("button", { name: "同步", exact: true }).count(), 1);
  const local = await page.locator(".sync-status").innerText();
  assert.doesNotMatch(local, /个 Issue|同步方式/);
  repo = baseRepo;

  // ── settings: sync mode and auto-sync ──
  await page.goto(base + "/settings");
  await page.getByRole("tab", { name: "Issue 同步" }).click();
  const enable = page.getByLabel("启用自动同步");
  await enable.waitFor();
  assert.equal(await enable.isChecked(), false);
  assert.equal(await page.getByLabel("同步方式").inputValue(), "incremental");
  await enable.check();
  const intervals = page.getByLabel("自动同步间隔");
  assert.ok((await intervals.locator("option").allInnerTexts()).includes("5 分钟"));
  await page.getByLabel("同步方式").selectOption("full");
  // Full sync is expensive: short intervals disappear and 30 min is raised to 1 hour.
  const options = await intervals.locator("option").allInnerTexts();
  assert.ok(!options.includes("5 分钟") && !options.includes("30 分钟") && options.includes("1 小时"));
  assert.equal(await intervals.inputValue(), "60");
  await intervals.selectOption("180");
  await page.getByRole("button", { name: "保存更改" }).click();
  await page.waitForTimeout(300);
  const saved = savedSettings.at(-1);
  assert.equal(saved.sync_mode, "full");
  assert.equal(saved.auto_sync_enabled, true);
  assert.equal(saved.auto_sync_interval, 180);
  assert.ok(!("auto_sync_mode" in saved));
  // Reloaded values come back from the server.
  await page.reload();
  await page.getByRole("tab", { name: "Issue 同步" }).click();
  assert.equal(await page.getByLabel("启用自动同步").isChecked(), true);
  assert.equal(await page.getByLabel("同步方式").inputValue(), "full");
  // The overview reflects the setting, and still shows one button.
  await page.goto(base + "/overview");
  assert.match(await page.locator(".sync-status").innerText(), /同步方式：全量 · 自动同步：每 180 分钟/);
  assert.equal(await page.getByRole("button", { name: "同步", exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log("Sync controls verified: single button, mode from settings, status line, auto-sync settings.");
} finally {
  await browser.close();
}
