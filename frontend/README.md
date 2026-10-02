# Signoff 前端

React + TypeScript + Vite + Tailwind。首页使用明确标注的示意数据，工作台通过 `/api` 访问 FastAPI 服务。示例仓库仅支持只读与模拟操作；个人导入仓库支持真实 Agent 执行。

```sh
npm ci
npm run dev
```

需要先启动后端。可在根目录使用 `start.ps1` / `start.sh` 同时启动；配置见[项目说明](../README.md)。

十个页面支持仓库导入、检索/AI 问答、漏洞扫描/复核、任务规划、版本化日历、权限审批、SSE 运行事件、报告与审计导出、后端设置。主题与当前仓库 ID 在浏览器保存；业务数据保存于后端数据库。

```sh
npm run build
npx playwright install chromium
npm run test:ui
```

`npm run test:fit` 单独验证“检索”“漏洞分析”两页在 1280×800、1440×900、1920×1080 下不出现滚动条、长内容进弹窗、Markdown 被渲染。它所有接口都用 mock，不需要后端：先 `VITE_PORT=5199 npx vite preview` 托管构建产物（可用 `FIT_BASE` 指向其他地址）；找不到 Playwright 自带 Chromium 时会回退到本机 Chrome / Edge。

`npm run test:agent` 验证 Agent 运行页在三种分辨率下一屏显示：配置里的长列表进弹窗、时间线按高度分页（从最新往回翻）、待批准卡片始终在屏内、diff / 测试输出用可滑动预览并在弹窗看全文；同样不需要后端。

`npm run test:sync` 同样用 mock 验证同步控件：概览页只有一个“同步”按钮（方式由设置决定）、同步中禁用、上次同步摘要与失败提示、设置页的同步方式与自动同步。

UI 检查使用服务端真实数据，并将亮暗主题截图保存到 `artifacts/screenshots/`。Agent/LLM 的真实执行由 `backend/scripts/verify_live.py` 验证。
