# Starts the API and the website in two windows and opens the browser.
#   powershell -ExecutionPolicy Bypass -File .\start.ps1     (or double-click start.bat)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

if (-not (Test-Path (Join-Path $Backend ".venv\Scripts\python.exe"))) {
    Write-Host "Setup has not been run yet. Running setup first..." -ForegroundColor Yellow
    & (Join-Path $Root "setup.ps1"); exit
}

Start-Process powershell -ArgumentList @("-NoExit", "-Command",
  "`$host.UI.RawUI.WindowTitle='Glass Store - API (keep open)'; Set-Location '$Backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000")
Start-Process powershell -ArgumentList @("-NoExit", "-Command",
  "`$host.UI.RawUI.WindowTitle='Glass Store - Website (keep open)'; Set-Location '$Frontend'; npm run dev")

Write-Host "Starting... the store opens in your browser in a few seconds." -ForegroundColor Cyan
Write-Host "Keep the two new windows open while you use the store. Close them to stop it."
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 1 }
}
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"
