import { launch } from "./launch.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const browser = await launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("artifacts/screenshots", { recursive: true });
  const health = await page.request.get("http://127.0.0.1:5173/api/health");
  assert.equal(health.status(), 200, "Both services must be running");
  const repos = await (
    await page.request.get("http://127.0.0.1:5173/api/repos")
  ).json();
  const repo = repos.find((r) => r.demo && r.status === "ready");
  assert.ok(repo, "Prepare the read-only demo snapshot before verifying the UI");
  await page.goto("http://127.0.0.1:5173/");
  await page.evaluate((id) => localStorage.setItem("ow-repo", id), repo.id);
  for (const route of [
    "",
    "repos",
    "overview",
    "search",
    "security",
    "planning",
    "calendar",
    "agent",
    "runs",
    "settings",
  ]) {
    await page.goto("http://127.0.0.1:5173/" + route);
    await page.locator(".ow").waitFor();
    if (route !== "")
      await page
        .getByText("oss-workbench-demo", { exact: true })
        .first()
        .waitFor();
    await page.waitForTimeout(300);
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /模拟数据|UI 原型|尚未接入后端/,
    );
    if ((await page.locator(".ow").getAttribute("data-theme")) === "dark")
      await page.getByLabel("切换深浅色主题").click();
    await page.screenshot({
      path: `artifacts/screenshots/${route || "landing"}-light.png`,
    });
    await page.getByLabel("切换深浅色主题").click();
    assert.equal(await page.locator(".ow").getAttribute("data-theme"), "dark");
    await page.screenshot({
      path: `artifacts/screenshots/${route || "landing"}-dark.png`,
    });
  }
  await page.goto("http://127.0.0.1:5173/search");
  await page.getByLabel("检索内容").fill("search_notes");
  await page.getByLabel("检索模式").selectOption("query");
  const query = page.waitForResponse((r) => r.url().includes("/search?"));
  await page.getByRole("button", { name: "检索", exact: true }).click();
  assert.equal((await query).status(), 200);
  await page
    .locator(".preview-body")
    .getByText("search_notes", { exact: false })
    .waitFor();
  await page.getByLabel("检索对象").selectOption("issue");
  await page.getByLabel("检索内容").fill("搜索");
  const issues = page.waitForResponse((r) => r.url().includes("kind=issue"));
  await page.getByRole("button", { name: "检索", exact: true }).click();
  const issueData = await (await issues).json();
  assert.ok(issueData.issues.length);
  await page.goto("http://127.0.0.1:5173/security");
  await page.getByLabel("严重度").selectOption("critical");
  await page.waitForTimeout(500);
  for (const row of await page.locator(".live-table tbody tr").all())
    assert.match(await row.innerText(), /critical/);
  await page.goto("http://127.0.0.1:5173/planning");
  const plans = await (
    await page.request.get(
      "http://127.0.0.1:5173/api/repos/" + repo.id + "/plans",
    )
  ).json();
  assert.ok(plans.length, "Generate a real LLM plan before verification");
  await page.getByLabel("每天可投入", { exact: true }).fill("3");
  const scheduled = page.waitForResponse((r) => r.url().endsWith("/schedule"));
  await page.getByRole("button", { name: "确认，生成排期" }).click();
  assert.equal((await scheduled).status(), 200);
  await page.waitForURL("**/calendar");
  await page.getByRole("button", { name: "月", exact: true }).click();
  assert.equal(await page.locator(".calendar-month > div").count(), 42);
  const runs = await (
    await page.request.get(
      "http://127.0.0.1:5173/api/repos/" + repo.id + "/runs",
    )
  ).json();
  const completed = runs.find((r) => r.status === "completed" && r.config.simulated);
  assert.ok(completed, "Run the simulated Agent verifier first");
  // The Agent page is a conversation: a finished run shows its diff summary,
  // the simulated test output inside the collapsed tool calls, and a PR preview.
  await page.goto("http://127.0.0.1:5173/agent?run=" + completed.id);
  await page.locator(".chat-result").waitFor();
  assert.match(
    await page.locator(".chat-result").innerText(),
    /虚拟修改了 \d+ 个文件/,
  );
  await page.locator(".chat-work, .chat-call").evaluateAll((els) =>
    els.forEach((el) => (el.open = true)),
  );
  await page.locator(".chat-call pre", { hasText: "未运行测试" }).last().waitFor();
  assert.equal(completed.tests.exit_code, null);
  assert.ok(
    await page.getByRole("button", { name: "预览 PR（模拟）" }).isEnabled(),
  );
  // Report downloads and the event hash chain live in the run record sheet.
  await page.goto("http://127.0.0.1:5173/runs");
  await page.getByLabel("搜索运行").fill(completed.id);
  await page.locator("tr.click", { hasText: completed.id }).click();
  await page.getByText("哈希链校验通过", { exact: true }).waitFor();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", { name: "JSON", exact: true }).click();
  assert.match((await downloaded).suggestedFilename(), /\.json$/);
  await page.goto("http://127.0.0.1:5173/settings");
  // Visitors may not read or change the service configuration.
  await page.getByText("设置仅对登录用户开放", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("模型", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("API Key").count(), 0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://127.0.0.1:5173/overview");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/screenshots/overview-1280.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5173/");
  await page.screenshot({
    path: "artifacts/screenshots/landing-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Verified 10 live routes, themes, real code/Issue search, scan filtering, persisted schedule, simulated test output, hash verification, report download, PR preview and guest settings gate.",
  );
} finally {
  await browser.close();
}
