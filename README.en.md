<div align="center">

# Sign<i>/</i>off

**From reading the code to opening the PR — the agent does the work, you sign off.**

A local-first, LLM-native workbench for maintaining open-source projects

[简体中文](README.md) · **English**

[![CI](https://github.com/JiaMingWang-CN/signoff/actions/workflows/ci.yml/badge.svg)](https://github.com/JiaMingWang-CN/signoff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-f05a05.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-0.2.0-121210.svg)
![Python](https://img.shields.io/badge/python-3.11%2B-3776ab.svg)
![Node.js](https://img.shields.io/badge/node-22.12%2B-5fa04e.svg)

</div>

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Workflow](#workflow)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Security and permission model](#security-and-permission-model)
- [Operational notes](#operational-notes)
- [Project structure](#project-structure)
- [Development and testing](#development-and-testing)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Overview

Maintaining an open-source project shouldn't mean juggling a dozen browser tabs. Signoff puts **reading code, finding vulnerabilities, planning, fixing, testing and opening PRs** on a single track: the agent does the work, you make the calls, and every step leaves a verifiable record.

- **Local-first**: a single-user workbench that binds to localhost by default; data lives in SQLite (default) or PostgreSQL.
- **Human in the loop**: out-of-bounds writes and commands require approval, and a PR is only committed, pushed and opened after you confirm it.
- **Honest records**: a failed or skipped test is never shown as a pass; every run event joins a SHA-256 hash chain, and reports can be verified.

> [!NOTE]
> The landing page shows clearly-labeled demo data. Repositories, search results, scans, plans, runs and reports in the workbench are all served by the FastAPI backend.

## Features

| Area | What it does |
| --- | --- |
| **Code search** | Symbols, source exploration, callers / callees and impact analysis, all powered by the locally installed codegraph CLI; issues are searched with SQLite FTS5. |
| **Ask AI** | A read-only agent: the model drives its own multi-step investigation (up to 8 steps) through codegraph, issue search and file reads, then synthesizes an answer. The UI shows the investigation and lists only the issues and `file:line` references actually cited. |
| **Vulnerability scanning** | OSV dependency checks (requirements, pyproject, package-lock, pnpm-lock, yarn.lock, go.mod) plus language-aware built-in rules; installed bandit / semgrep join automatically; LLM review is triggered separately and past scans are kept. |
| **Planning & calendar** | An LLM summarizes, deduplicates and estimates issues; once assignees, effort and capacity are confirmed, a deterministic backend algorithm builds a versioned calendar. Natural-language adjustments are previewed before they apply. |
| **Agent fixes** | On personal repositories the agent really reads, writes and runs tests in a dedicated git worktree, with approvals and a stop button; on the demo repository it only produces virtual files and a preview diff. |
| **PRs & audit** | Commit, push and open a PR after human confirmation (auto-forking when you lack push rights); run events form a hash chain, reports export as Markdown / JSON, and audit records as CSV. |
| **Issue sync** | Incremental (GitHub `since`) or full sync, with optional auto-sync; each sync records its mode, trigger and added / updated / deleted counts. |
| **Console** | Query and drive the whole workbench in natural language; it may call the PR endpoint after user authorization. |

## Workflow

```text
 Import ──▶ Search / Ask AI ──▶ Scan ──▶ Plan ──▶ Agent fix ──▶ Human review ──▶ Open PR ──▶ Report
   │                                                 │               │
   └ demo: read-only snapshot                        └ worktree      └ you sign off
```

1. **Import**: a guest clicks "try the demo repository" — a read-only snapshot of `DEMO_REPO` is downloaded once, a codegraph index is built, and issues with comments are read. This is data preparation; the demo project's own code is never executed. Later demo syncs only return previews and never pull or modify the snapshot. After signing in with GitHub you can import personal and organization repositories, as well as local Git repositories with commits.
2. **Search & Q&A**: symbols, exploration, call relationships and impact analysis all go through codegraph. Ask AI file reads are restricted to the repository; `.git` and `.env` are forbidden.
3. **Scan**: a `package.json` with version ranges but no lock file is flagged; test files are not flagged for hardcoded secrets, and other rules are lowered to `low` in test files; missing or failing bandit / semgrep runs are recorded as such.
4. **Plan**: restoring a past version creates a new version rather than overwriting history.
5. **Fix**: on the demo repository, tests and shell commands return simulated "not executed" results (exit code `null`) that never count as passing; on personal repositories, editing code invalidates previous test results.
6. **Open a PR**: for personally imported GitHub repositories this requires sign-in, a finished run (or a manual review approval) and a diff, followed by human confirmation. The code-fixing agent itself has no commit / push / PR tools. The PR endpoint does not currently require tests to pass, but test results are always shown as they are.
7. **Report**: reports read the full persisted event log and verify the hash chain. The chain detects record corruption; it is not an external proof of signature.

## Tech stack

- **Backend**: Python 3.11+ · FastAPI · SQLModel · SQLite (FTS5) / PostgreSQL · OpenAI-compatible LLM API
- **Frontend**: React 19 · TypeScript · Vite · Tailwind CSS · GSAP
- **Code intelligence**: [codegraph](https://www.npmjs.com/package/@colbymchenry/codegraph) CLI (installed locally, not bundled, no MCP)
- **Security data**: [OSV](https://osv.dev) · optional bandit / semgrep

## Quick start

### Prerequisites

- Python **3.11+**
- Node.js **22.12+**
- Git
- **codegraph CLI** (provides search, symbols, call relationships and impact analysis):

```sh
npm i -g @colbymchenry/codegraph   # verified version 1.6.0
```

> [!TIP]
> The start scripts check for codegraph first: if it is missing they fail with the command above, and a version outside 1.6.x triggers a warning. The `codegraph` field of `GET /api/health` also reports availability, the current version and whether it is verified. If the CLI is not on PATH, set `CODEGRAPH_BIN` in `backend/.env`.

### 1. Clone and configure

```sh
git clone https://github.com/JiaMingWang-CN/signoff.git
cd signoff
cp backend/.env.example backend/.env   # edit as needed; defaults work for local use
```

If `APP_SECRET` is left empty, one is generated and saved to `backend/data/session.secret`; to create your own: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Secrets stay on the backend and never reach the frontend.

### 2. First run (installs dependencies)

```powershell
# Windows, from the repo root
.\start.ps1
```

```sh
# Linux
bash start.sh
```

The start scripts create the Python virtual environment, install backend and frontend dependencies and start both services; Ctrl+C stops the services started by that run.

### 3. Day-to-day development

Once dependencies are in place, from the repo root:

```sh
npm install   # first time only
npm run dev
```

`npm run dev` starts backend and frontend together with logs tagged `backend` / `frontend`; Ctrl+C stops both, and either service exiting shuts down the other. You can also run `backend/.venv/Scripts/python.exe backend/run.py` and `cd frontend && npm run dev` separately.

| Service | URL |
| --- | --- |
| Frontend | http://127.0.0.1:5173 |
| Backend | http://127.0.0.1:8000 |

The frontend reaches the backend through the same-origin `/api` proxy, including the OAuth callback and SSE. Stop any service already listening on those ports first.

### 4. Configure a model

Open the **Settings** page and enter the Base URL, model and API key of an OpenAI-compatible endpoint (the API key is stored encrypted in the database).

## Configuration

All server-side settings live in `backend/.env`; see [`backend/.env.example`](backend/.env.example) for the annotated template.

| Variable | Default | Description |
| --- | --- | --- |
| `APP_SECRET` | auto-generated | Encrypts stored GitHub tokens and signs the session cookie; at least 32 random bytes. Generated and saved to `backend/data/session.secret` when empty. |
| `PUBLIC_URL` | `http://127.0.0.1:5173` | Frontend URL as seen by the browser; the OAuth callback is `{PUBLIC_URL}/api/auth/github/callback`. |
| `BACKEND_HOST` / `BACKEND_PORT` | `127.0.0.1` / `8000` | Backend listen address. |
| `DATABASE_URL` | `sqlite:///./data/workbench.db` | The SQLite path is relative to `backend`; use `postgresql+psycopg://...` for PostgreSQL. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | — | GitHub OAuth App credentials. |
| `GITHUB_OAUTH_SCOPES` | `repo read:user` | OAuth scopes. |
| `ALLOWED_GITHUB_USERS` | empty | Comma-separated GitHub usernames allowed to sign in. When empty, any account may sign in locally; if `PUBLIC_URL` is not a loopback address, sign-in is refused until it is set. |
| `DEMO_REPO` | `JiaMingWang-CN/oss-workbench-demo` | The sign-in-free demo repository. |
| `DEMO_GITHUB_TOKEN` | empty | Token used to read the demo repository (a read-only fine-grained PAT is recommended); anonymous access (60 requests/hour) when empty. |
| `GUEST_DAILY_AGENT_RUNS` / `GUEST_DAILY_LLM_TOKENS` | `5` / `200000` | Daily guest quota per IP. |
| `LLM_TIMEOUT_SECONDS` | `120` | LLM request timeout. |
| `WORKSPACE_DIR` | `~/.oss-workbench/workspaces` | Workspace root (one clone per repository, one worktree per run). |
| `AGENT_DEFAULT_PERMISSION` | `approve` | Default permission preset: `readonly` \| `approve` \| `auto` \| `full`. |
| `AGENT_MAX_STEPS` / `AGENT_COMMAND_TIMEOUT_SECONDS` | `40` / `300` | Agent step limit and per-command timeout. |
| `CODEGRAPH_BIN` | `codegraph` | Path to the codegraph CLI. |
| `OSV_API_URL` | `https://api.osv.dev/v1` | OSV API endpoint. |
| `SEMGREP_BIN` / `BANDIT_BIN` | `semgrep` / `bandit` | Optional static analyzers; skipped when not installed. |

## Security and permission model

> [!IMPORTANT]
> Signoff is a **local, single-user workbench** bound to localhost by default. On personal repositories, shell commands and tests are local processes and the working directory is **not an OS sandbox**. Read [SECURITY.md](SECURITY.md) and set `ALLOWED_GITHUB_USERS` before exposing the service.

### Demo repository (read-only)

- The read-only restriction is decided by the backend from `DEMO_REPO` and applies to guests and signed-in users alike, including follow-ups on existing runs; neither signing in nor choosing full permission bypasses it.
- The agent reads source only; writes and edits are stored as virtual files (kept only in the run record) that produce a preview diff, and no worktree is created.
- Static scanning and indexing only read the snapshot and never execute the project; `bash` only previews the command.
- PRs are preview-only: nothing is committed, pushed or forked, and no real PR is created.

### Personal repositories

- The agent really reads, writes and runs tests in a dedicated git worktree.
- File tools check the workspace scope via resolved paths and deny access to `.git` and `.env`.
- Calls not on the safe-command list require approval; full permission requires a second confirmation.
- Bash allow / deny lists (regular expressions) are configured on the Settings page: a deny match blocks the call; an allow match skips the built-in safe-command check, while dangerous commands still need approval.
- Opening a PR: pushed directly to `owb/<run-id>` when you have push rights; otherwise the repository is forked automatically and the PR is opened from the fork.

### Guests and accounts

- **On a public deployment (`PUBLIC_URL` is not a loopback address), guests are view-only**: they can browse the demo repository's overview, issues, scans, plans and reports, but every write request (POST / PUT / PATCH / DELETE) — sync, Ask AI, scans, planning, agent runs, the console, PRs, settings — is rejected by the backend with "This is a demo version, please deploy locally from the repository" and the repository link. Signed-in users are not restricted.
- Local deployments (loopback address) do not apply this restriction: without signing in you can still use the demo repository, with presets limited to read-only or simulated: no full permission, custom directory or custom test command.
- Changing settings, importing local repositories, viewing the audit log and creating real PRs all require GitHub sign-in.
- On local deployments guest quotas are counted per client IP (the frontend proxy forwards `X-Forwarded-For`) and set in the environment configuration; guests of a public deployment cannot start these operations, so no quota is consumed.
- OAuth tokens are stored encrypted; access tokens with refresh info are refreshed before they expire.

### What counts as "tests passed"

- Only an actual test command (pytest / npm test / go test or the run's configured custom command) counts, and pytest must execute at least one collected case; `--collect-only`, `git status` and the like are never recorded as passing.
- Automated Python tests for personal repositories use the backend's Python environment; for other projects, prepare dependencies first or set a custom test command that uses their own environment. Reports record the actual command and full output.
- `requirements-demo.txt` remains only as the demo's test dependency manifest; demo mode never executes those tests.

## Operational notes

- **Calendar capacity**: an agent task is capped at 4 hours per day, and multiple tasks share the daily capacity by concurrency; dependent tasks start on the next working day. Priority 0 is highest, 4 lowest.
- **Budget exhaustion**: on reaching the maximum step count or token budget, a run moves to "needs review" and keeps its diff instead of failing.
- **Service restarts**: unfinished runs are marked interrupted with events and artifacts preserved; re-running a personal repository creates a fresh worktree, while the demo is simulated again — nothing in progress is disguised as a success. Unfinished sync markers are cleared.
- **Issue sync**: choose the mode on the Settings page —
  - **Incremental**: uses GitHub's `since` to pull only issues and comments updated since the last sync and merges them; falls back to full when there is no baseline; deleted / transferred issues are not detected.
  - **Full**: re-pulls everything and replaces it, capped at 1000 issues.

  The overview page has a single "Sync" button; manual sync and optional auto-sync (enabled on the Settings page with a chosen interval) both use this mode, and automatic full syncs run at most once per hour. A ready repository stays usable while syncing; a failure only records the error and leaves existing data untouched.
- **Auto-sync**: applies only to personally imported GitHub repositories and uses the GitHub identity of the last sync for that repository (paused on sign-out, with a notice on the overview page). The demo repository never auto-syncs; `DEMO_GITHUB_TOKEN` is only used to read the initial snapshot data.
- **Database upgrades**: new columns are backfilled automatically on existing databases.

## Project structure

```text
signoff/
├── backend/
│   ├── workbench/          # FastAPI application
│   │   ├── app.py          # routes and app entry point
│   │   ├── agent.py        # agent runs, tools and approvals
│   │   ├── console.py      # console assistant
│   │   ├── qa.py           # Ask AI (read-only agent)
│   │   ├── security.py     # vulnerability scanning and LLM review
│   │   ├── planning.py     # deterministic scheduling
│   │   ├── sync.py         # issue sync
│   │   ├── services.py     # codegraph / git / encryption services
│   │   ├── db.py           # data models and search
│   │   └── config.py       # settings
│   ├── tests/              # pytest
│   ├── scripts/            # live verification script
│   └── run.py
├── frontend/
│   ├── src/
│   │   ├── home/           # landing page
│   │   ├── pages/          # workbench pages
│   │   ├── components/
│   │   └── layout/
│   └── scripts/            # Playwright verification scripts
├── scripts/dev.mjs         # npm run dev: starts backend and frontend
├── start.ps1 / start.sh    # first-run scripts
└── .github/workflows/ci.yml
```

## Development and testing

```sh
# Backend tests — Linux
cd backend && .venv/bin/python -m pytest -q

# Backend tests — Windows (PowerShell)
cd backend
.\.venv\Scripts\python.exe -m pytest -q

# Frontend: type check + production build
cd frontend && npm run build
```

- `npm run test:ui` needs both services running and Playwright Chromium: `npx playwright install chromium`.
- `backend/scripts/verify_live.py` uses the current LLM to verify simulated fixes on the demo repository; it consumes LLM tokens and guest run quota, but creates no worktree, modifies no demo source, runs no tests and opens no PR.

## Contributing

Issues and pull requests are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, conventions and test requirements.

## Security

Please **do not** report security vulnerabilities in public issues; see [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE). Third-party dependencies keep their own licenses; see [NOTICES.md](NOTICES.md).

<div align="center">

[简体中文](README.md) · **English**

</div>
