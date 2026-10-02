$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskVerifiedCodegraph = '1.6.0'
if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
  throw '未找到 codegraph。检索能力依赖本机安装的 codegraph，请先运行：npm i -g @colbymchenry/codegraph'
}
$taskCodegraph = (& codegraph --version | Select-Object -First 1).Trim()
if (-not $taskCodegraph.StartsWith(($taskVerifiedCodegraph -replace '\.\d+$', '.'))) {
  Write-Warning "codegraph 版本为 $taskCodegraph，已验证版本为 $taskVerifiedCodegraph；检索输出格式可能不同。"
}
$taskPython = Join-Path $taskRoot 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
  python -m venv (Join-Path $taskRoot 'backend/.venv')
  if ($LASTEXITCODE -ne 0) { throw '创建 Python 环境失败' }
}
& $taskPython -m pip install --upgrade 'pip>=26.2.0'
if ($LASTEXITCODE -ne 0) { throw '升级 pip 失败' }
& $taskPython -m pip install -r (Join-Path $taskRoot 'backend/requirements.txt') -r (Join-Path $taskRoot 'backend/requirements-demo.txt')
if ($LASTEXITCODE -ne 0) { throw '安装后端依赖失败' }
Push-Location (Join-Path $taskRoot 'frontend')
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw '安装前端依赖失败' }
  $taskServer = Start-Process -FilePath $taskPython -ArgumentList @('run.py') -WorkingDirectory (Join-Path $taskRoot 'backend') -WindowStyle Hidden -PassThru
  Write-Host 'Signoff: http://127.0.0.1:5173'
  try { npm run dev } finally { if (-not $taskServer.HasExited) { Stop-Process -Id $taskServer.Id } }
} finally { Pop-Location }
