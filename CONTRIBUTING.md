# 贡献指南

欢迎为 Signoff 贡献代码。本项目是本地运行的单用户工作台（FastAPI + React），提交前请先跑通测试。English: [README.en.md](README.en.md)。

## 开发环境

- Python 3.11+、Node.js 22.12+、Git
- codegraph CLI（检索、符号与调用关系能力依赖它，不随本项目分发）：`npm i -g @colbymchenry/codegraph`（已验证 1.6.x）

首次准备依赖：

```sh
cd backend
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt   # Windows: .venv\Scripts\python.exe

cd ../frontend
npm ci
```

也可以直接用启动脚本（会自动准备依赖并检查 codegraph）：根目录运行 `bash start.sh`（Linux）或 `.\start.ps1`（Windows）。

日常开发在根目录运行 `npm run dev` 同时启动前后端：前端 http://127.0.0.1:5173、后端 http://127.0.0.1:8000，Ctrl+C 同时停止，任一服务退出也会关闭另一个。

配置见 `backend/.env`（参考 `backend/.env.example`）。LLM 的 Base URL、模型与 API Key 在网页“设置”页配置；密钥不进入前端，也不要写进代码。

## 测试

```sh
# Linux
cd backend && .venv/bin/python -m pytest -q

# Windows (PowerShell)
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

```sh
cd frontend
npm run build        # TypeScript 检查 + 生产构建
```

- `npm run test:ui` 需要前后端已启动，并安装 Playwright Chromium（`npx playwright install chromium`）。
- `npm run test:fit` / `test:agent` / `test:sync` 使用 mock、不需要后端，但需要先托管构建产物：`VITE_PORT=5199 npx vite preview`。
- `backend/scripts/verify_live.py` 会消耗真实 LLM token 与访客运行配额，仅在必要时运行。

## 提交与 PR

- 约定式提交（`feat:` / `fix:` / `style:` / `test:` / `docs:` / `chore:`），正文用中文说明变更要点，格式参考 `git log`。
- 每个提交保持可测试：提交前跑一遍上面的后端测试与前端构建。
- PR 流程：fork → 新分支 → 测试通过 → 提交到 `main`，在描述中说明变更与验证方式。
- 界面与文档为中文，新增用户可见文案请用中文；代码注释中英文均可。
- 换行符由 `.gitattributes` 统一为 LF（PowerShell 脚本除外），不要手动处理。

## 不要提交的内容

`.env`、密钥、token、数据库文件、`.venv`、`node_modules`、`dist` 已在 `.gitignore` 中覆盖。CI 会对全历史做 gitleaks 密钥扫描；如误提交密钥，请立即在对应平台**吊销**并重写历史，只删除文件不能消除泄露。
