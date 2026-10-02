// Verifies the Agent 运行 page (the conversation layout): the page never scrolls
// as a whole, long tool runs collapse into one block, approvals stay on screen,
// tool/advanced settings live in dialogs and reach the request, the result card
// shows the diff summary and the guarded PR button, and follow-ups continue the
// same worktree. All API calls are mocked.
// Serve a build first:  VITE_PORT=5199 npx vite preview   (override with FIT_BASE)
import { launch } from "./launch.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.FIT_BASE || "http://127.0.0.1:5199";
const repo = {
  id: "repo-agent",
  name: "owner/demo",
  source: "github",
  path: "/w/demo",
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
const task = { id: "T1", title: "修复搜索", why: "", src: "", dep: "—", h: 1, who: "agent", priority: 1 };
const plan = {
  id: "plan-1",
  repo_id: repo.id,
  status: "applied",
  version: 1,
  summary: "",
  created: "2026-10-01T00:00:00Z",
  capacity: {},
  calendar: [],
  tasks: [task],
};

let nextEvent = 0;
const event = (kind, data) => ({
  id: ++nextEvent,
  kind,
  data,
  hash: "hash" + nextEvent,
  created: "2026-10-01T00:00:" + String(nextEvent % 60).padStart(2, "0") + "Z",
});
const call = (id, tool, args, result) => [
  event("tool_call", { call_id: id, tool, arguments: args, permission: "allow" }),
  event("tool_result", { call_id: id, tool, result }),
];

// A long run that is now waiting for approval: forty reads, then a write.
const waitingEvents = [
  event("llm", { text: "我先读一下搜索模块。", tokens: 10 }),
  ...Array.from({ length: 40 }, (_, i) => call("r" + i, "read", { path: `app/file_${i}.py` }, "x".repeat(50))).flat(),
  event("tool_call", {
    call_id: "w1",
    tool: "write",
    arguments: { path: "app/search.py", content: "x = 1\n".repeat(500) },
    permission: "ask",
  }),
  event("approval_requested", {
    approval_id: "a1",
    tool: "write",
    arguments: { path: "app/search.py", content: "x = 1\n".repeat(500) },
  }),
];
// The same task, finished: two files changed and the tests passed.
const doneEvents = [
  event("llm", { text: "已定位到问题，开始修改。", tokens: 10 }),
  ...call("e1", "edit", { path: "app/search.py" }, { ok: true }),
  ...call("t1", "run_tests", {}, { exit_code: 0, stdout: "........\n17 passed in 0.59s" }),
  event("llm", { text: "修复完成，测试全部通过。", tokens: 10 }),
];
const diff = [
  "diff --git a/app/search.py b/app/search.py",
  "--- a/app/search.py",
  "+++ b/app/search.py",
  "@@ -1,2 +1,3 @@",
  "-old = 1",
  "+new = 1",
  "+extra = 2",
  "diff --git a/app/export.py b/app/export.py",
  "--- a/app/export.py",
  "+++ b/app/export.py",
  "@@ -1 +1 @@",
  "-shell = True",
  "+shell = False",
].join("\n");
const runBase = {
  id: "run-1",
  repo_id: repo.id,
  task,
  config: { preset: "approve", tools: {}, directory: "", full_confirmed: false, max_steps: 40, max_tokens: 200000, test_command: "" },
  path: "C:/Users/me/.oss-workbench/workspaces/owner__demo/runs/run-1",
  branch: "owb/run-1",
  base_sha: "abc",
  commit_sha: "",
  tests: null,
  tokens: 1234,
  error: "",
  created: "2026-10-01T00:00:00Z",
  finished: "",
  pr_url: "",
  hash_valid: true,
};
const waitingRun = { ...runBase, status: "waiting", diff: "", events: waitingEvents };
const doneRun = {
  ...runBase,
  status: "completed",
  diff,
  tests: { command: "pytest -q", output: "17 passed", exit_code: 0 },
  events: doneEvents,
};

async function noScroll(page, label) {
  const m = await page.evaluate(() => {
    const main = document.querySelector("main.live-main");
    const composer = document.querySelector(".chat-composer")?.getBoundingClientRect();
    return {
      main: main.scrollHeight - main.clientHeight,
      page: document.documentElement.scrollHeight - innerHeight,
      composerBottom: composer ? composer.bottom - innerHeight : null,
    };
  });
  assert.ok(m.main <= 1, `${label}: main scrolls by ${m.main}px`);
  assert.ok(m.page <= 1, `${label}: page scrolls by ${m.page}px`);
  assert.ok(m.composerBottom === null || m.composerBottom <= 1, `${label}: composer is below the fold`);
}

async function centered(page, label) {
  const box = await page.evaluate(() => {
    const r = document.querySelector("dialog[open]").getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: innerWidth, h: innerHeight };
  });
  assert.ok(
    Math.abs(box.cx - box.w / 2) < 2 && Math.abs(box.cy - box.h / 2) < 2,
    `${label}: dialog is not centred`,
  );
}

const settings = {
  llm_base_url: "", llm_model: "", llm_configured: true, workspace_dir: "", default_permission: "approve",
  bash_allow: [], bash_deny: [], sync_mode: "incremental", auto_sync_enabled: false, auto_sync_interval: 60,
  max_steps: 40, command_timeout: 300, max_tokens: 200000, tools: {}, database: "SQLite",
};

async function openPage(browser, width, height, { user, demo = false }) {
  const page = await browser.newPage({ viewport: { width, height } });
  const state = { run: waitingRun, runs: [waitingRun], plans: [plan], user };
  const posted = { approvals: [], runs: [], messages: [], prs: [] };
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((id) => localStorage.setItem("ow-repo", id), repo.id);
  await page.route("**/api/repos", (r) => r.fulfill({ json: [{ ...repo, demo }] }));
  await page.route("**/api/auth/me", (r) =>
    r.fulfill({
      json: {
        user: state.user ? { login: "me", avatar_url: "", html_url: "" } : null,
        demo_repo: repo.name,
        oauth_configured: true,
      },
    }),
  );
  await page.route("**/api/settings", (r) => r.fulfill({ json: settings }));
  await page.route("**/api/repos/*/plans", (r) => r.fulfill({ json: state.plans }));
  await page.route("**/api/repos/*/runs", (r) => {
    if (r.request().method() === "POST") {
      posted.runs.push(r.request().postDataJSON());
      return r.fulfill({ json: state.run });
    }
    return r.fulfill({ json: state.runs });
  });
  await page.route("**/api/runs/run-1", (r) => r.fulfill({ json: state.run }));
  await page.route("**/api/runs/*/events*", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" }),
  );
  await page.route("**/api/runs/*/approvals/*", (r) => {
    posted.approvals.push(r.request().postDataJSON());
    return r.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/runs/*/messages", (r) => {
    posted.messages.push(r.request().postDataJSON());
    return r.fulfill({ json: state.run });
  });
  await page.route("**/api/runs/*/pr", (r) => {
    posted.prs.push(r.request().postDataJSON());
    return r.fulfill({ json: demo
      ? { simulated: true, url: "", message: "PR 模拟预览：未提交、未推送、未创建 Pull Request。" }
      : { url: "https://github.com/owner/demo/pull/1" } });
  });
  return { page, state, posted, errors };
}

const browser = await launch();
try {
  await mkdir("artifacts/screenshots", { recursive: true });
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]) {
    const tag = `${width}x${height}`;
    const { page, state, posted, errors } = await openPage(browser, width, height, { user: true });

    // ── a long run: forty reads collapse into one block, the page does not grow ──
    await page.goto(base + "/agent?run=run-1");
    await page.locator(".chat-work").first().waitFor();
    assert.match(await page.locator(".chat-work > summary").first().innerText(), /读取了 40 个文件/);
    assert.equal(await page.locator(".chat-call").first().isVisible(), false, "tool calls start collapsed");
    assert.equal(await page.locator(".chat-list-item").count(), 1);
    await noScroll(page, "agent " + tag);

    // ── approval: on screen without scrolling, long arguments in a dialog ──
    const approval = page.locator(".approval");
    await approval.waitFor();
    const inView = await approval.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    assert.ok(inView, "approval card is on screen");
    for (const name of ["批准", "拒绝", "本次运行始终允许"])
      assert.ok(await approval.getByRole("button", { name, exact: true }).isVisible(), name);
    await approval.getByRole("button", { name: "查看参数" }).click();
    await page.locator("dialog[open]").waitFor();
    await centered(page, "arguments dialog " + tag);
    assert.match(await page.locator("dialog[open]").innerText(), /app\/search\.py/);
    await page.keyboard.press("Escape");
    await approval.getByRole("button", { name: "批准", exact: true }).click();
    await page.waitForTimeout(150);
    assert.deepEqual(posted.approvals, [{ decision: "approve" }]);

    // ── configuration: long lists live in dialogs, not in the composer ──
    assert.equal(await page.getByLabel("read权限").count(), 0, "tool list is not inline");
    assert.equal(await page.getByLabel("工作目录").count(), 0, "advanced fields are not inline");
    await page.getByRole("button", { name: /^工具权限/ }).click();
    await page.locator("dialog[open]").waitFor();
    await centered(page, "tools dialog " + tag);
    assert.equal(await page.locator("dialog[open] .tool-row").count(), 8);
    await page.getByLabel("write权限").selectOption("deny");
    await page.keyboard.press("Escape");
    assert.match(await page.getByRole("button", { name: /^工具权限/ }).innerText(), /（1）/);
    await page.getByRole("button", { name: "高级", exact: true }).click();
    await page.locator("dialog[open]").waitFor();
    await centered(page, "advanced dialog " + tag);
    await page.getByLabel("最大步数").fill("12");
    await page.getByLabel("测试命令").fill("pytest -q");
    await page.keyboard.press("Escape");
    await noScroll(page, "agent after config dialogs " + tag);

    // ── a new conversation sends the dialog settings with the task ──
    await page.getByRole("button", { name: "新对话" }).click();
    await page.getByText("让 Agent 修复一个问题").waitFor();
    await noScroll(page, "agent empty conversation " + tag);
    await page.getByLabel("任务描述").fill("修复搜索排序");
    state.run = waitingRun;
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForTimeout(150);
    assert.equal(posted.runs.length, 1);
    assert.equal(posted.runs[0].task.title, "修复搜索排序");
    assert.equal(posted.runs[0].config.max_steps, 12);
    assert.equal(posted.runs[0].config.test_command, "pytest -q");
    assert.deepEqual(posted.runs[0].config.tools, { write: "deny" });

    // ── a finished run: diff summary, test output, guarded PR, follow-up ──
    state.run = doneRun;
    state.runs = [doneRun];
    await page.goto(base + "/agent?run=run-1");
    const result = page.locator(".chat-result");
    await result.waitFor();
    assert.match(await result.innerText(), /修改了 2 个文件\s*\+3\s*−2/);
    assert.equal(await result.locator(".chat-file").count(), 2);
    await page.locator(".chat-work > summary").first().click();
    await page.locator(".chat-call", { hasText: "17 passed" }).locator("summary").click();
    assert.ok(await page.locator(".chat-call pre", { hasText: "17 passed" }).isVisible(), "test output is readable");
    const prButton = page.getByRole("button", { name: "由我确认并创建 PR" });
    assert.equal(await prButton.isDisabled(), false, "signed-in PR button is enabled");
    await prButton.click();
    await page.locator("dialog[open]").waitFor();
    await centered(page, "pr dialog " + tag);
    assert.match(await page.locator("dialog[open]").innerText(), /owb\/run-1/);
    await page.keyboard.press("Escape");
    assert.equal(posted.prs.length, 0, "nothing is pushed before the user confirms");
    await noScroll(page, "agent finished run " + tag);
    await page.screenshot({ path: `artifacts/screenshots/fit-agent-${tag}.png` });
    const input = page.getByLabel("任务描述");
    assert.match((await input.getAttribute("placeholder")) || "", /继续追问/);
    await input.fill("再补一个回归测试");
    await input.press("Enter");
    await page.waitForTimeout(150);
    assert.deepEqual(posted.messages, [{ text: "再补一个回归测试" }]);

    // ── a visitor cannot open a PR or pick the unattended presets ──
    state.user = false;
    await page.reload();
    await result.waitFor();
    assert.equal(await page.getByRole("button", { name: "由我确认并创建 PR" }).isDisabled(), true);
    await page.getByText("创建 PR 需要 GitHub 登录").waitFor();
    await page.goto(base + "/agent?run=new");
    assert.equal(await page.locator('select[aria-label="权限预设"] option[value="auto"]').isDisabled(), true);
    assert.equal(await page.locator('select[aria-label="权限预设"] option[value="full"]').isDisabled(), true);

    // ── edge states: no planned tasks, and no conversations at all ──
    state.plans = [];
    state.runs = [];
    await page.goto(base + "/agent");
    await page.getByText("还没有对话").waitFor();
    await page.getByText("让 Agent 修复一个问题").waitFor();
    assert.match(await page.locator('select[aria-label="选择任务"]').innerText(), /规划里暂无任务/);
    await noScroll(page, "agent without runs " + tag);
    assert.deepEqual(errors, [], tag);
    await page.close();
  }
  for (const user of [false, true]) {
    const { page, state, posted, errors } = await openPage(browser, 1280, 800, { user, demo: true });
    const tests = { simulated: true, command: "pytest -q", exit_code: null, output: "模拟预览：未执行任何命令，未运行测试，不代表测试通过。" };
    state.run = { ...doneRun, config: { ...doneRun.config, simulated: true }, tests, events: [
      ...call("sim-edit", "edit", { path: "app/search.py" }, { simulated: true }),
      ...call("sim-test", "run_tests", { command: "pytest -q" }, tests),
    ] };
    state.runs = [state.run];
    await page.goto(base + "/agent?run=run-1");
    await page.getByText("示例仓库只读；文件改动、测试、命令和 PR 均为模拟，源码不会改变。", { exact: true }).waitFor();
    assert.match(await page.locator(".chat-result").innerText(), /虚拟修改了 2 个文件/);
    await page.locator(".chat-work > summary").click();
    await page.locator(".chat-call", { hasText: "未运行测试" }).locator("summary").click();
    assert.ok(await page.locator(".chat-call pre", { hasText: "不代表测试通过" }).isVisible());
    await page.getByRole("button", { name: "预览 PR（模拟）", exact: true }).click();
    await page.getByText("仅展示虚拟 diff，不提交、不推送、不创建真实 PR。", { exact: true }).waitFor();
    assert.equal(posted.prs.length, 0);
    await page.getByRole("button", { name: "查看模拟结果", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "未创建 Pull Request" }).waitFor();
    assert.equal(posted.prs.length, 1);
    await page.goto(base + "/agent?run=new");
    for (const preset of ["auto", "full"])
      assert.ok(await page.locator(`select[aria-label="权限预设"] option[value="${preset}"]`).isDisabled());
    assert.equal(await page.getByRole("button", { name: /^工具权限/ }).count(), 0);
    await page.getByRole("button", { name: "高级", exact: true }).click();
    assert.ok(await page.getByLabel("工作目录").isDisabled());
    assert.ok(await page.getByLabel("测试命令").isDisabled());
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Agent 运行 fits one screen at 3 viewports; conversation, dialogs, approvals, PR guard, follow-ups and demo simulation for visitors and signed-in users verified.");
} finally {
  await browser.close();
}
