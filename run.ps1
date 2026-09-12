# Cortex — one-command dev launcher (Windows / PowerShell)
# Starts the FastAPI backend (:8000) and the Vite frontend (:5173).
# Uses the portable Node + ffmpeg under .tools if present.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Put portable Node on PATH for this session if it exists.
$nodeDir = Join-Path $root ".tools\node-v22.11.0-win-x64"
if (Test-Path $nodeDir) { $env:PATH = "$nodeDir;" + $env:PATH }

# Backend
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "Creating Python venv + installing backend deps..."
  python -m venv (Join-Path $root ".venv")
  & $py -m pip install -r (Join-Path $root "backend\requirements.txt")
}

Write-Host "Starting backend on http://127.0.0.1:8000 ..."
$backend = Start-Process -PassThru -NoNewWindow -FilePath $py `
  -ArgumentList "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000" `
  -WorkingDirectory $root

# Frontend
$fe = Join-Path $root "frontend"
if (-not (Test-Path (Join-Path $fe "node_modules"))) {
  Write-Host "Installing frontend deps..."
  Push-Location $fe; npm install; Pop-Location
}

Write-Host "Starting frontend on http://localhost:5173 ..."
Push-Location $fe
try {
  npm run dev
} finally {
  Pop-Location
  if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
}
