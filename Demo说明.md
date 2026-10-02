# Signoff Demo 说明

> 从读代码到开 PR，Agent 来干活，你来签字（sign off）。

## 一、创意

维护开源项目不该是在十几个浏览器标签页之间来回切换。Signoff 把**读代码、找漏洞、排计划、改代码、跑测试、提 PR** 放到同一条轨道上：

- **Agent 负责执行**：检索代码、调查问题、生成修复方案与改动。
- **人负责决策**：越界的写入与命令需要审批；PR 只有在你确认后才会提交、推送并创建。
- **记录真实可查**：失败或跳过的测试绝不显示为“通过”；每个运行事件进入 SHA-256 哈希链，报告可校验。

定位：**本地优先（local-first）、单用户、LLM 原生**的开源项目维护工作台。

## 二、主要功能

| 功能 | 说明 |
| --- | --- |
| 代码检索 | 符号、源码探索、调用方/被调用方、影响面分析，由本机 codegraph CLI 提供；Issues 使用 SQLite FTS5 全文检索。 |
| Ask AI | 只读 Agent，最多 8 步自主调查（codegraph、Issue 检索、文件读取），最终只列出真正引用的 Issue 与 `file:line`。 |
| 漏洞扫描 | OSV 依赖检查 + 内置规则，可自动接入 bandit / semgrep；LLM 复核可单独触发，历史扫描保留。 |
| 计划与日历 | LLM 汇总、去重、估算 Issue；确认负责人、工时与容量后，由确定性算法生成带版本的日历；自然语言调整先预览再生效。 |
| Agent 修复 | 个人仓库：在独立 git worktree 中真实读写并跑测试，支持审批与停止；示例仓库：仅生成虚拟文件与预览 diff。 |
| PR 与审计 | 人工确认后提交、推送、开 PR（无推送权限时自动 fork）；报告可导出 Markdown / JSON，审计记录可导出 CSV。 |
| Issue 同步 | 增量或全量同步，可自动同步，并记录每次同步的模式、触发方式与增删改数量。 |
| 控制台 | 用自然语言查询并驱动整个工作台，经授权后可调用 PR 接口。 |

## 三、Demo 模式（线上只读演示）

线上演示（如 https://www.signoff.top）面向访客**只能查看**：可以浏览示例仓库 `JiaMingWang-CN/oss-workbench-demo`（由 `DEMO_REPO` 配置）的概览、Issues、扫描结果、计划与报告；点击同步、Ask AI、扫描、规划、Agent 运行、控制台、创建 PR 等任何操作按钮，都会提示：

> 当前为演示版本，请前往仓库进行本地部署：https://github.com/JiaMingWang-CN/signoff

以下限制适用于示例仓库，在本地部署（未登录时）同样生效，**全程只读、安全**：

- 首次点击“体验示例仓库”时，下载一份只读快照、建立 codegraph 索引、读取 Issues 与评论；**不会执行示例项目的任何代码**。
- Agent 的写入/编辑只保存为虚拟文件并生成预览 diff，不创建 worktree。
- 测试与 shell 命令返回模拟的“未执行”结果（退出码 `null`），不会计为通过。
- PR 仅预览：不提交、不推送、不 fork、不创建真实 PR。
- 本地部署未登录时，访客有每 IP 每日额度（默认 5 次 Agent 运行、20 万 LLM tokens），只能使用只读/模拟权限。

## 四、使用方式

### 1. 环境要求

- Python 3.11+、Node.js 22.12+、Git
- codegraph CLI：`npm i -g @colbymchenry/codegraph`

### 2. 启动

```sh
git clone https://github.com/JiaMingWang-CN/signoff.git
cd signoff
cp backend/.env.example backend/.env   # 本机试用可保持默认
```

```powershell
.\start.ps1        # Windows，首次启动自动准备依赖
```

```sh
bash start.sh      # Linux
```

之后日常开发：`npm install`（仅首次）→ `npm run dev`。

| 服务 | 地址 |
| --- | --- |
| 前端 | http://127.0.0.1:5173 |
| 后端 | http://127.0.0.1:8000 |

### 3. 配置模型

打开网页 **设置** 页，填写 OpenAI 兼容接口的 Base URL、模型与 API Key（加密后存入数据库）。

### 4. 体验流程（本地部署）

1. 打开 http://127.0.0.1:5173，点击 **体验示例仓库**，等待快照与索引准备完成。
2. **检索 / Ask AI**：搜索符号，或用自然语言提问，查看调查过程与引用。
3. **扫描**：运行漏洞扫描，查看依赖与代码规则发现的问题。
4. **计划**：让 LLM 汇总 Issues，确认负责人与容量，生成日历。
5. **Agent 修复**：发起一次运行，查看虚拟文件与预览 diff（Demo 不会真正改动或测试）。
6. **报告**：查看运行事件、哈希链校验结果，并导出 Markdown / JSON。

若想体验完整流程（真实改代码、跑测试、开 PR），请用 GitHub 登录并导入个人仓库；PR 创建前始终需要你的人工确认。

> 安全提示：Signoff 是本地单用户工作台，个人仓库的 shell 与测试是本机进程，工作目录不是操作系统沙箱。对外暴露服务前请阅读 [SECURITY.md](SECURITY.md) 并设置 `ALLOWED_GITHUB_USERS`。
