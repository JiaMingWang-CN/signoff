#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$task_root"
task_verified_codegraph='1.6.0'
if ! command -v codegraph >/dev/null 2>&1; then
  echo '未找到 codegraph。检索能力依赖本机安装的 codegraph，请先运行：npm i -g @colbymchenry/codegraph' >&2
  exit 1
fi
task_codegraph="$(codegraph --version | head -n 1)"
case "$task_codegraph" in
  "${task_verified_codegraph%.*}".*) ;;
  *) echo "警告：codegraph 版本为 $task_codegraph，已验证版本为 $task_verified_codegraph；检索输出格式可能不同。" >&2 ;;
esac
if [ ! -x backend/.venv/bin/python ]; then python3 -m venv backend/.venv; fi
backend/.venv/bin/python -m pip install --upgrade 'pip>=26.2.0'
backend/.venv/bin/python -m pip install -r backend/requirements.txt -r backend/requirements-demo.txt
(cd frontend && npm ci)
(cd backend && .venv/bin/python run.py) &
task_server_pid=$!
trap 'kill "$task_server_pid" 2>/dev/null || true' EXIT INT TERM
echo 'Signoff: http://127.0.0.1:5173'
cd frontend
npm run dev
