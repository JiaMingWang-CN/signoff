// Verifies that 检索 and 漏洞分析 fit in one screen (no scrolling), that unbounded
// content opens in dialogs, and that Markdown is rendered. API responses with
// deliberately huge payloads are mocked so the check does not depend on data.
import { launch } from "./launch.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Serve a build with `VITE_PORT=5199 npx vite preview` and point FIT_BASE at it;
// every API call is mocked, so no backend is needed.
const base = process.env.FIT_BASE || "http://127.0.0.1:5199";
const issues = Array.from({ length: 30 }, (_, i) => ({
  number: i + 1,
  title: "Issue 标题 " + "很长的标题 ".repeat(10) + (i + 1),
  body: "## 现象\n\n- 复现步骤一\n- 复现步骤二\n\n```\ntraceback\n```",
  state: i % 3 ? "open" : "closed",
  labels: ["bug", "security"],
  html_url: "https://example.com/issues/" + (i + 1),
  comments_text: "**评论**：已确认",
}));
const repo = {
  id: "repo-fit",
  name: "owner/demo",
  source: "github",
  path: "",
  branch: "main",
  sha: "abcdef1234",
  status: "ready",
  error: "",
  updated: "2026-10-01T00:00:00Z",
  issues,
  progress: [],
  stats: { file_count: 3, languages: { ".py": 3 } },
};
const longMarkdown =
  "## 结论\n\n报错来自 `app/search.py:17` 的 SQL 拼接，见 Issue #3。\n\n" +
  Array.from({ length: 60 }, (_, i) => `- 第 ${i + 1} 条说明，内容较长，用来撑满回答区域并验证不会出现滚动条`).join("\n") +
  "\n\n| 文件 | 行 |\n|---|---|\n| app/search.py | 17 |\n\n```python\nsql = f\"SELECT * FROM notes\"\n```\n";
const exploreText =
  "**Exploration: search_notes**\n\nFound 19 symbols across 3 files.\n\n" +
  Array.from({ length: 200 }, (_, i) => `- \`symbol_${i}\` (app/file_${i}.py:${i + 1})`).join("\n");
const findings = Array.from({ length: 45 }, (_, i) => ({
  id: "SEC-" + (i + 1),
  title: "动态代码执行 " + "很长的标题 ".repeat(12),
  severity: ["critical", "high", "medium", "low"][i % 4],
  source: "内置规则",
  rule: "eval-exec",
  file: "very/deep/path/to/some/module/file_" + i + ".py",
  line: i + 1,
  code: "x = 1",
  suggestion: "## 修复\n\n使用 `safe_load`。",
  explanation: "**确认**：这是真实问题。\n\n- 原因一\n- 原因二",
  review: "确认",
  status: "open",
}));
const scan = {
  id: "scan-fit",
  status: "complete",
  findings,
  sources: [
    { name: "内置规则", status: "complete" },
    {
      name: "OSV.dev",
      status: "partial",
      reason: "已查询 21 个依赖；3 个 package.json 没有锁文件，只有版本范围，无法精确查询：a/package.json, b/package.json, c/package.json",
    },
    { name: "semgrep", status: "skipped", reason: "未安装" },
  ],
  error: "",
  sha: "abcdef1234567890",
  created: "2026-10-01T03:32:38Z",
};

async function centered(page, label) {
  const box = await page.evaluate(() => {
    const r = document.querySelector("dialog[open]").getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: innerWidth, h: innerHeight };
  });
  assert.ok(
    Math.abs(box.cx - box.w / 2) < 2 && Math.abs(box.cy - box.h / 2) < 2,
    `${label}: dialog centre (${Math.round(box.cx)}, ${Math.round(box.cy)}) is not the viewport centre (${box.w / 2}, ${box.h / 2})`,
  );
}

// A preview scrolls inside its own box, shows an animated "scroll down" hint
// while more content is below, and drops the hint once the end is reached.
async function previewBehaves(page, scope, label) {
  const body = page.locator(`${scope} .preview-body`).first();
  const hint = page.locator(`${scope} .preview-hint`).first();
  const metrics = await body.evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    scrolls: el.scrollHeight > el.clientHeight,
  }));
  assert.ok(["auto", "scroll"].includes(metrics.overflowY) && metrics.scrolls, `${label}: preview is scrollable`);
  assert.match(await hint.innerText(), /向下滑动.*点击查看全部/, `${label}: hint text`);
  assert.notEqual(
    await hint.locator(".arrow").evaluate((el) => getComputedStyle(el).animationName),
    "none",
    `${label}: arrow is animated`,
  );
  await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await hint.waitFor({ state: "detached" });
  await body.evaluate((el) => (el.scrollTop = 0));
  await hint.waitFor();
}

async function noScroll(page, label) {
  const m = await page.evaluate(() => {
    const main = document.querySelector("main.live-main");
    return {
      main: main.scrollHeight - main.clientHeight,
      page: document.documentElement.scrollHeight - innerHeight,
    };
  });
  assert.ok(m.main <= 1, `${label}: main scrolls by ${m.main}px`);
  assert.ok(m.page <= 1, `${label}: page scrolls by ${m.page}px`);
}

const browser = await launch();
try {
  await mkdir("artifacts/screenshots", { recursive: true });
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((id) => localStorage.setItem("ow-repo", id), repo.id);
    const tag = `${width}x${height}`;
    await page.route("**/api/repos", (route) => route.fulfill({ json: [repo] }));
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        json: { user: null, demo_repo: repo.name, oauth_configured: false },
      }),
    );
    await page.route("**/api/settings", (route) =>
      route.fulfill({
        json: {
          llm_base_url: "",
          llm_model: "",
          llm_configured: true,
          workspace_dir: "",
          default_permission: "approve",
          bash_allow: [],
          bash_deny: [],
          max_steps: 40,
          command_timeout: 300,
          max_tokens: 200000,
          tools: {},
          database: "SQLite",
        },
      }),
    );

    // ── 漏洞分析 ──
    await page.route("**/api/repos/*/scans", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: [scan] })
        : route.continue(),
    );
    await page.goto(base + "/security");
    await page.locator(".live-table tbody tr").first().waitFor();
    await noScroll(page, "security " + tag);
    const fit = await page.evaluate(() => {
      const area = document.querySelector(".fit-area").getBoundingClientRect();
      const heads = [...document.querySelectorAll(".live-table th")].map((t) =>
        t.getBoundingClientRect(),
      );
      return { areaRight: area.right, lastRight: heads.at(-1).right, count: heads.length };
    });
    assert.equal(fit.count, 6);
    assert.ok(
      fit.lastRight <= fit.areaRight + 1,
      `security ${tag}: last column ends at ${fit.lastRight}, container at ${fit.areaRight}`,
    );
    // Header and body text sit in the vertical middle of their cells.
    const offsets = await page.evaluate(() => {
      const off = (cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const text = range.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        return Math.abs(text.top + text.height / 2 - (box.top + box.height / 2));
      };
      return {
        head: Math.max(...[...document.querySelectorAll(".live-table th")].map(off)),
        body: Math.max(
          ...[...document.querySelectorAll(".live-table tbody tr:first-child td")].map(off),
        ),
      };
    });
    assert.ok(offsets.head <= 2, `security ${tag}: header text is ${offsets.head}px off centre`);
    assert.ok(offsets.body <= 2, `security ${tag}: cell text is ${offsets.body}px off centre`);
    const visible = await page.locator(".live-table tbody tr").count();
    assert.ok(visible > 0 && visible < findings.length, "rows are paginated");
    await page.getByLabel("下一页").click();
    assert.match(await page.locator(".pager").innerText(), /2\s*\/\s*\d+/);
    await page.locator(".live-table tbody tr").first().click();
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    await centered(page, "finding dialog " + tag);
    assert.ok(await dialog.locator("h2").count(), "suggestion markdown rendered");
    assert.ok(await dialog.locator("li").count(), "explanation markdown rendered");
    assert.doesNotMatch(await dialog.innerText(), /\*\*确认\*\*|## 修复/);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /扫描来源/ }).click();
    assert.match(await page.locator("dialog[open]").innerText(), /3 个 package\.json 没有锁文件/);
    await page.keyboard.press("Escape");
    await noScroll(page, "security after dialogs " + tag);
    await page.screenshot({ path: `artifacts/screenshots/fit-security-${tag}.png` });

    // ── 检索 ──
    await page.route("**/api/repos/*/search?*", (route) =>
      route.fulfill({
        json: route.request().url().includes("kind=issue")
          ? { issues }
          : { text: exploreText, mode: "explore", sha: "x" },
      }),
    );
    await page.route("**/api/repos/*/ask", (route) =>
      route.fulfill({
        json: {
          answer: longMarkdown,
          tokens: 1234,
          steps: [{ tool: "search_code", args: { query: "q" }, chars: 10, error: false }],
          sources: [
            { type: "issue", number: 3, title: "搜索笔记时报错", url: "https://example.com/3" },
            { type: "code", file: "app/search.py", line: 17 },
          ],
        },
      }),
    );
    await page.goto(base + "/search");
    await page.getByLabel("检索内容").fill("search_notes");
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await page.locator(".fit-area .preview-hint").waitFor();
    await noScroll(page, "search result " + tag);
    await page.getByLabel("AI 问题").fill("为什么报错");
    await page.getByRole("button", { name: "发送" }).click();
    await page.locator(".answer .preview-hint").waitFor();
    await noScroll(page, "search answer " + tag);
    assert.equal(
      await page.getByRole("button", { name: /查看完整/ }).count(),
      0,
      "the old 查看完整… buttons are gone",
    );
    assert.doesNotMatch(await page.locator(".answer").innerText(), /^## |\*\*|`/m);
    await previewBehaves(page, ".answer", "answer " + tag);
    await previewBehaves(page, ".fit-area", "result " + tag);
    await page.locator(".answer .preview-body").evaluate((el) => (el.scrollTop = 0));
    await page.locator(".answer .preview-hint").click();
    const answer = page.locator("dialog[open]");
    await answer.waitFor();
    await centered(page, "answer dialog " + tag);
    assert.ok(await answer.locator("h2").count(), "answer heading rendered");
    assert.ok(await answer.locator("table").count(), "answer table rendered");
    assert.ok(await answer.locator("pre code").count(), "answer code block rendered");
    assert.ok(await answer.locator("li").count() > 50, "answer list rendered");
    assert.doesNotMatch(await answer.innerText(), /^## |\|---\|/m);
    await page.keyboard.press("Escape");
    await page.locator(".fit-area .preview-body").evaluate((el) => (el.scrollTop = 0));
    await page.locator(".fit-area .preview-hint").click();
    await page.locator("dialog[open]").waitFor();
    await centered(page, "result dialog " + tag);
    assert.ok(await page.locator("dialog[open] li").count() > 100, "result markdown rendered");
    await page.keyboard.press("Escape");
    // Issue list: paginated, long titles truncated, details in a dialog.
    await page.getByLabel("检索对象").selectOption("issue");
    await page.getByLabel("检索内容").fill("bug");
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await page.locator(".issue-item").first().waitFor();
    await noScroll(page, "search issues " + tag);
    const shown = await page.locator(".issue-item").count();
    assert.ok(shown > 0 && shown < issues.length, "issue list is paginated");
    await page.locator(".pager").getByLabel("下一页").click();
    await page.locator(".issue-item").first().click();
    const issueDialog = page.locator("dialog[open]");
    await centered(page, "issue dialog " + tag);
    assert.ok(await issueDialog.locator("h2").count(), "issue body markdown rendered");
    assert.ok(await issueDialog.locator("pre code").count(), "issue code block rendered");
    assert.doesNotMatch(await issueDialog.innerText(), /## 现象|\*\*评论\*\*/);
    await page.keyboard.press("Escape");
    await noScroll(page, "search after dialogs " + tag);
    await page.screenshot({ path: `artifacts/screenshots/fit-search-${tag}.png` });
    assert.deepEqual(errors, [], tag);
    await page.close();
  }
  console.log("检索 and 漏洞分析 fit one screen at 3 viewports; dialogs and Markdown verified.");
} finally {
  await browser.close();
}
