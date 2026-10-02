<div align="center">

# Sign<i>/</i>off

**从读懂代码，到提交 PR —— Agent 动手，你来签核。**

本地运行、LLM 原生的开源项目维护工作台

**简体中文** · [English](README.en.md)

[![CI](https://github.com/JiaMingWang-CN/signoff/actions/workflows/ci.yml/badge.svg)](https://github.com/JiaMingWang-CN/signoff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-f05a05.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-0.2.0-121210.svg)
![Python](https://img.shields.io/badge/python-3.11%2B-3776ab.svg)
![Node.js](https://img.shields.io/badge/node-22.12%2B-5fa04e.svg)

</div>

---

## 目录

- [简介](#简介)
- [功能特性](#功能特性)
- [工作流程](#工作流程)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [配置](#配置)
- [安全与权限模型](#安全与权限模型)
- [运行说明](#运行说明)
- [项目结构](#项目结构)
- [开发与测试](#开发与测试)
- [参与贡献](#参与贡献)
- [安全问题](#安全问题)
- [许可证](#许可证)

## 简介

维护开源项目，不该是在十几个标签页之间来回切换。Signoff 把**读代码、找漏洞、排期、修复、测试与提交 PR** 收进同一条链路：Agent 负责动手，你负责拍板，每一步都留下可以校验的记录。

- **本地优先**：单用户工作台，默认只绑定本机；数据保存在 SQLite（默认）或 PostgreSQL。
- **人在回路**：越界的写入与命令需要审批，PR 必须由你确认后才会提交、推送和创建。
- **如实记录**：测试失败或未执行不会伪装成通过；每个运行事件进入 SHA-256 哈希链，报告可校验。

> [!NOTE]
> 首页展示的是明确标注的示意数据；工作台中的仓库、检索结果、扫描、规划、运行与报告均由 FastAPI 后端提供。

## 功能特性

| 模块 | 能力 |
| --- | --- |
| **代码检索** | 符号、源码探索、调用方 / 被调用方、影响面分析，全部基于本机 codegraph CLI；Issue 使用 SQLite FTS5 全文检索。 |
| **问 AI** | 只读 Agent：模型自行调用 codegraph、Issue 检索与文件读取多轮调查（最多 8 步）后整合回答，界面展示调查过程，只列出实际引用的 Issue 与 `文件:行号`。 |
| **漏洞扫描** | OSV 依赖漏洞（requirements、pyproject、package-lock、pnpm-lock、yarn.lock、go.mod）+ 按语言区分的内置规则；已安装的 bandit / semgrep 自动参与；LLM 复核单独触发，历史扫描保留。 |
| **规划与日历** | LLM 汇总、去重并估算问题；确认执行方、工时与容量后，由后端确定性算法排出日历并保存版本；自然语言调整先预览后应用。 |
| **Agent 修复** | 个人仓库在独立 git worktree 中真实读写与运行测试，写入 / 命令可暂停审批、随时停止；示例仓库只生成虚拟文件与预览 diff。 |
| **PR 与审计** | 人工确认后提交、推送并创建 PR（无推送权限时自动 fork）；运行事件形成哈希链，报告支持 Markdown / JSON，审计记录支持 CSV 导出。 |
| **Issue 同步** | 增量（GitHub `since`）或全量同步，可选自动同步；每次同步记录方式、触发来源与增删改数量。 |
| **总控台** | 用自然语言查询和指挥整个工作台；在用户授权后可调用 PR 接口。 |

## 工作流程

```text
 导入仓库 ──▶ 检索 / 问 AI ──▶ 漏洞扫描 ──▶ 规划排期 ──▶ Agent 修复 ──▶ 人工审核 ──▶ 创建 PR ──▶ 报告
   │                                                     │                │
   └ 示例仓库：只读快照                                    └ worktree 隔离   └ 由你签核
```

1. **导入**：访客点击“体验示例仓库”，首次下载 `DEMO_REPO` 的只读快照，建立 codegraph 索引并读取 Issues 与评论。这是数据准备，不执行示例项目代码；后续示例同步只返回预览，不拉取或修改快照。GitHub 登录后可导入个人与组织仓库，也可导入本机已提交的 Git 仓库。
2. **检索与问答**：符号、源码探索、调用关系、影响面均调用 codegraph。问 AI 的文件读取限定在仓库内，禁止访问 `.git` / `.env`。
3. **扫描**：只有版本范围而无锁文件的 `package.json` 会在结果里提示；测试文件不报硬编码密钥，其余规则在测试文件中降为 low；bandit / semgrep 未安装或失败会如实记录。
4. **规划**：恢复历史版本会创建新版本，不覆盖原记录。
5. **修复**：示例仓库的测试和 shell 命令只返回“未执行”的模拟结果（退出码 `null`），不计为测试通过；个人仓库修改代码会作废旧测试结果。
6. **提交 PR**：个人导入的 GitHub 仓库须登录、运行完成（或经人工审核通过）且有 diff，人工确认后才提交、推送并创建 PR。代码修复 Agent 本身没有提交、推送和创建 PR 的工具。当前 PR 接口不要求测试成功，但测试结果会如实展示。
7. **报告**：报告读取完整落库事件并校验哈希链。哈希链用于检测记录损坏，不等同于外部签名证明。

## 技术栈

- **后端**：Python 3.11+ · FastAPI · SQLModel · SQLite（FTS5）/ PostgreSQL · OpenAI 兼容 LLM 接口
- **前端**：React 19 · TypeScript · Vite · Tailwind CSS · GSAP
- **代码智能**：[codegraph](https://www.npmjs.com/package/@colbymchenry/codegraph) CLI（本机安装，不随项目分发，不使用 MCP）
- **安全数据**：[OSV](https://osv.dev) · 可选 bandit / semgrep

## 快速开始

### 环境要求

- Python **3.11+**
- Node.js **22.12+**
- Git
- **codegraph CLI**（检索、符号、调用关系与影响面都由它提供）：

```sh
npm i -g @colbymchenry/codegraph   # 已验证版本 1.6.0
```

> [!TIP]
> 启动脚本会先检查 codegraph：未安装则直接报错并给出上面的命令，版本与 1.6.x 不同时给出警告。`GET /api/health` 的 `codegraph` 字段也会显示是否可用、当前版本以及是否为已验证版本。CLI 不在 PATH 时，在 `backend/.env` 里用 `CODEGRAPH_BIN` 指定路径。

### 1. 克隆与配置

```sh
git clone https://github.com/JiaMingWang-CN/signoff.git
cd signoff
cp backend/.env.example backend/.env   # 按需填写，本机试用可保持默认
```

`APP_SECRET` 留空时会自动生成并保存到 `backend/data/session.secret`；也可以自行生成：`python -c "import secrets; print(secrets.token_urlsafe(48))"`。密钥只保存在后端，不会进入前端。

### 2. 首次启动（自动准备依赖）

```powershell
# Windows，在项目根目录运行
.\start.ps1
```

```sh
# Linux
bash start.sh
```

启动脚本会创建 Python 虚拟环境、安装前后端依赖并启动服务；Ctrl+C 停止本次启动的服务。

### 3. 日常开发

依赖准备好后，在根目录运行：

```sh
npm install   # 仅首次
npm run dev
```

`npm run dev` 同时启动前后端，日志带 `backend` / `frontend` 标签；Ctrl+C 同时停止两个服务，任一服务退出也会关闭另一个。也可以分别运行 `backend/.venv/Scripts/python.exe backend/run.py` 与 `cd frontend && npm run dev`。

| 服务 | 地址 |
| --- | --- |
| 前端 | http://127.0.0.1:5173 |
| 后端 | http://127.0.0.1:8000 |

前端通过 `/api` 同源代理访问后端，包括 OAuth 回调和 SSE。启动前请先关闭占用相同端口的服务。

### 4. 配置模型

打开网页 **设置** 页，填写 OpenAI 兼容接口的 Base URL、模型与 API Key（API Key 加密后存入数据库）。

## 配置

所有服务端配置位于 `backend/.env`，完整说明见 [`backend/.env.example`](backend/.env.example)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_SECRET` | 自动生成 | 加密数据库中的 GitHub token、签名会话 cookie，至少 32 字节随机串；留空时自动生成并保存到 `backend/data/session.secret`。 |
| `PUBLIC_URL` | `http://127.0.0.1:5173` | 浏览器访问的前端地址；OAuth 回调为 `{PUBLIC_URL}/api/auth/github/callback`。 |
| `BACKEND_HOST` / `BACKEND_PORT` | `127.0.0.1` / `8000` | 后端监听地址。 |
| `DATABASE_URL` | `sqlite:///./data/workbench.db` | SQLite 路径相对于 `backend`；PostgreSQL 使用 `postgresql+psycopg://...`。 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | — | GitHub OAuth App 凭据。 |
| `GITHUB_OAUTH_SCOPES` | `repo read:user` | OAuth 授权范围。 |
| `ALLOWED_GITHUB_USERS` | 空 | 允许登录的 GitHub 用户名（逗号分隔）。留空时本机任何账号可登录；`PUBLIC_URL` 不是本机地址时，未填写则拒绝登录。 |
| `DEMO_REPO` | `JiaMingWang-CN/oss-workbench-demo` | 免登录示例仓库。 |
| `DEMO_GITHUB_TOKEN` | 空 | 读取示例仓库用的 token（建议只读 fine-grained PAT）；留空则匿名访问（60 次/小时）。 |
| `GUEST_DAILY_AGENT_RUNS` / `GUEST_DAILY_LLM_TOKENS` | `5` / `200000` | 访客每 IP 每日限额。 |
| `LLM_TIMEOUT_SECONDS` | `120` | LLM 请求超时。 |
| `WORKSPACE_DIR` | `~/.oss-workbench/workspaces` | 工作区根目录（每个仓库一个 clone，每次运行一个 worktree）。 |
| `AGENT_DEFAULT_PERMISSION` | `approve` | 默认权限预设：`readonly` \| `approve` \| `auto` \| `full`。 |
| `AGENT_MAX_STEPS` / `AGENT_COMMAND_TIMEOUT_SECONDS` | `40` / `300` | Agent 最大步数与单条命令超时。 |
| `CODEGRAPH_BIN` | `codegraph` | codegraph CLI 路径。 |
| `OSV_API_URL` | `https://api.osv.dev/v1` | OSV 接口地址。 |
| `SEMGREP_BIN` / `BANDIT_BIN` | `semgrep` / `bandit` | 可选静态扫描器，未安装时自动跳过。 |

## 安全与权限模型

> [!IMPORTANT]
> Signoff 是**本地运行的单用户工作台**，默认绑定本机。个人仓库的 shell 与测试是本机进程，工作目录**不是操作系统沙箱**。对外暴露服务前请阅读 [SECURITY.md](SECURITY.md) 并设置 `ALLOWED_GITHUB_USERS`。

### 示例仓库（只读）

- 只读限制由后端按 `DEMO_REPO` 判定，对访客和登录用户均生效，包含已有运行的继续追问；登录或选择完全权限都不能绕过。
- Agent 只读源码，写入与编辑仅保存为虚拟文件（只存在于运行记录中）并生成预览 diff，不创建 worktree。
- 静态扫描和索引只读取快照，不执行项目程序；`bash` 只提供命令预览。
- PR 仅预览：不提交、不推送、不 fork，也不创建真实 PR。

### 个人仓库

- Agent 在独立 git worktree 中真实读写与运行测试。
- 文件工具通过 resolve 后的路径检查工作区范围，禁止访问 `.git` / `.env`。
- 未列为安全命令的调用需要审批；完全权限需二次确认。
- Bash 白名单 / 黑名单（正则）在设置页配置：黑名单命中即禁止；白名单命中则跳过内置安全命令检查，危险命令仍需审批。
- 创建 PR：对仓库有推送权限时直接推送 `owb/<run-id>`；否则自动 fork 并从 fork 发起 PR。

### 访客与账号

- **公网部署（`PUBLIC_URL` 不是本机地址）时，访客只能查看**：可浏览示例仓库的概览、Issues、扫描结果、计划与报告，但同步、Ask AI、扫描、规划、Agent 运行、控制台、PR、修改设置等任何写类请求（POST / PUT / PATCH / DELETE）（点击“体验示例仓库”打开示例仓库除外）都由后端拒绝，并提示“当前为演示版本，请前往仓库进行本地部署”及仓库链接。登录用户不受此限制。
- 本地部署（回环地址）不启用该限制：未登录时仍可使用示例仓库，权限预设仅支持只读或模拟；不能使用完全权限、自定义目录或自定义测试命令。
- 修改设置、导入本机仓库、查看审计日志、创建真实 PR 都需要 GitHub 登录。
- 本地部署下的访客额度按客户端 IP 统计（前端代理会转发 `X-Forwarded-For`），限额在环境配置中设置；公网部署的访客不能发起这些操作，额度不会被消耗。
- OAuth token 加密落库；带刷新信息的 access token 在到期前自动刷新。

### 测试结果判定

- “测试通过”只认测试命令（pytest / npm test / go test 或运行配置中的自定义测试命令），且 pytest 至少执行了一个用例；`--collect-only`、`git status` 之类不会记为通过。
- 个人仓库的 Python 自动测试使用后端 Python 环境；其他项目请先准备依赖，或填写使用其自身环境的自定义测试命令。报告保存实际命令与完整输出。
- `requirements-demo.txt` 仅保留为示例测试依赖清单，示例模式不会执行这些测试。

## 运行说明

- **日历容量**：Agent 单任务每天最多 4 小时，多任务按并发数共享日容量；依赖完成后下一工作日开始。优先级 0 最高、4 最低。
- **预算耗尽**：达到最大步数或 token 预算时，运行转为“待复核”并保留 diff，而不是直接失败。
- **服务重启**：未完成的运行标记为中断，事件和产物保留；个人仓库重新执行会创建新的 worktree，示例仓库重新执行仍为模拟，不把未结束进程伪装为成功。未完成的同步标记会被清除。
- **Issue 同步**：在设置页选择同步方式——
  - **增量**：用 GitHub 的 `since` 只拉取自上次同步以来有更新的 Issue 与评论并合并；没有基线时自动回退为全量；无法发现已删除 / 转移的 Issue。
  - **全量**：重新拉取全部并替换，上限 1000 个。

  概览页只有一个“同步”按钮，手动同步与可选的自动同步（设置页开启并选择间隔）都使用该方式；自动全量的间隔不少于 1 小时。同步已就绪的仓库时仓库保持可用，失败只记录错误，不影响现有数据。
- **自动同步**：仅用于个人导入的 GitHub 仓库，使用最近一次同步该仓库的 GitHub 登录身份（退出登录后暂停并在概览页提示）。示例仓库不参加自动同步，`DEMO_GITHUB_TOKEN` 仅用于首次读取快照相关数据。
- **数据库升级**：已有数据库会自动补齐新增列。

## 项目结构

```text
signoff/
├── backend/
│   ├── workbench/          # FastAPI 应用
│   │   ├── app.py          # 路由与应用入口
│   │   ├── agent.py        # Agent 运行、工具与审批
│   │   ├── console.py      # 总控台助手
│   │   ├── qa.py           # 问 AI（只读 Agent）
│   │   ├── security.py     # 漏洞扫描与 LLM 复核
│   │   ├── planning.py     # 确定性排期算法
│   │   ├── sync.py         # Issue 同步
│   │   ├── services.py     # codegraph / git / 加密等服务
│   │   ├── db.py           # 数据模型与检索
│   │   └── config.py       # 配置
│   ├── tests/              # pytest
│   ├── scripts/            # 实机验证脚本
│   └── run.py
├── frontend/
│   ├── src/
│   │   ├── home/           # 首页
│   │   ├── pages/          # 工作台页面
│   │   ├── components/
│   │   └── layout/
│   └── scripts/            # Playwright 验证脚本
├── scripts/dev.mjs         # npm run dev：同时启动前后端
├── start.ps1 / start.sh    # 首次启动脚本
└── .github/workflows/ci.yml
```

## 开发与测试

```sh
# 后端测试 —— Linux
cd backend && .venv/bin/python -m pytest -q

# 后端测试 —— Windows (PowerShell)
cd backend
.\.venv\Scripts\python.exe -m pytest -q

# 前端：TypeScript 检查 + 生产构建
cd frontend && npm run build
```

- `npm run test:ui` 需要前后端均已启动，并安装 Playwright Chromium：`npx playwright install chromium`。
- `backend/scripts/verify_live.py` 使用当前 LLM 在示例仓库上验证模拟修复；会消耗 LLM token 与访客运行配额，但不创建 worktree、不修改示例源码、不执行测试，也不创建 PR。

## 参与贡献

欢迎提交 Issue 与 Pull Request！开发环境、提交规范与测试要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全问题

请**不要**在公开 Issue 中报告安全漏洞，处理方式见 [SECURITY.md](SECURITY.md)。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。第三方依赖遵循各自许可证，清单见 [NOTICES.md](NOTICES.md)。

<div align="center">

**简体中文** · [English](README.en.md)

</div>
