# ---------------------------------------------------------------------------
#  Glass Luxury Store - one-time setup for Windows
#  Run from the project folder:
#     powershell -ExecutionPolicy Bypass -File .\setup.ps1
#  (or double-click setup.bat)
#  Safe to run again at any time - it only does what is missing.
# ---------------------------------------------------------------------------
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

function Step($text)  { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text)    { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text)  { Write-Host "    !   $text" -ForegroundColor Yellow }
function Fail($text)  { Write-Host ""; Write-Host "SETUP STOPPED: $text" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

Write-Host "Glass Luxury Store - setup" -ForegroundColor White

# ---------------------------------------------------------------- 1. Python
Step "Checking Python"
$py = $null
if (Get-Command py -ErrorAction SilentlyContinue) { $py = @("py", "-3") }
elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $v = & python --version 2>&1
    if ($v -match "Python 3") { $py = @("python") }
}
if (-not $py) { Fail "Python 3.11+ was not found. Install it from https://www.python.org/downloads/ (tick 'Add to PATH'), then run setup again." }
$pyExe = $py[0]; $pyArgs = @($py | Select-Object -Skip 1)
$ver = & $pyExe @pyArgs --version 2>&1
Ok "$ver"

# ---------------------------------------------------------------- 2. Node
Step "Checking Node.js"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "Node.js was not found. Install the LTS version from https://nodejs.org/ and run setup again." }
Ok ("Node " + (& node --version))

# ---------------------------------------------------------------- 3. Backend virtual environment
Step "Preparing the backend (Python packages)"
Set-Location $Backend
$venvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    & $pyExe @pyArgs -m venv .venv
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the Python virtual environment." }
    Ok "Created backend\.venv"
}
& $venvPython -m pip install --upgrade pip --quiet --disable-pip-version-check
& $venvPython -m pip install -r requirements.txt --quiet --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { Fail "Installing Python packages failed. Scroll up for the error." }
Ok "Python packages installed"

# ---------------------------------------------------------------- 4. backend\.env
Step "Configuring backend\.env"
$envFile = Join-Path $Backend ".env"
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $Backend ".env.example") $envFile; Ok "Created backend\.env from the template" }
$envText = Get-Content $envFile -Raw

if ($envText -match "DATABASE_URL=postgresql\+psycopg://postgres:password@") {
    Write-Host "    Enter the password of your PostgreSQL 'postgres' user (typed characters are hidden)."
    $sec = Read-Host "    PostgreSQL password" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    $enc = [uri]::EscapeDataString($plain)
    $envText = $envText -replace "DATABASE_URL=.*", "DATABASE_URL=postgresql+psycopg://postgres:$enc@localhost:5432/glass_ecom"
    Ok "Database connection saved"
}
if ($envText -match "SECRET_KEY=replace_with_a_secure_random_secret") {
    $secret = & $venvPython -c "import secrets; print(secrets.token_urlsafe(48))"
    $envText = $envText -replace "SECRET_KEY=.*", "SECRET_KEY=$secret"
    Ok "Generated a secret key"
}
if ($envText -notmatch "CORS_ORIGINS=.*127\.0\.0\.1:5173") {
    $envText = $envText -replace "CORS_ORIGINS=.*", "CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173"
}
[IO.File]::WriteAllText($envFile, $envText.TrimEnd() + "`r`n", (New-Object System.Text.UTF8Encoding $false))

# ---------------------------------------------------------------- 5. Database
Step "Creating the database"
& $venvPython -m scripts.ensure_db
if ($LASTEXITCODE -ne 0) { Fail "Fix the database connection (see message above). You can edit DATABASE_URL in backend\.env, then run setup again." }

Step "Creating tables"
& $venvPython -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { Fail "Database migration failed. Scroll up for the error." }
Ok "Tables are up to date"

Step "Loading categories, sample products and demo accounts"
& $venvPython -m scripts.seed --demo-accounts
if ($LASTEXITCODE -ne 0) { Fail "Loading sample data failed." }

# ---------------------------------------------------------------- 6. Frontend
Step "Preparing the website (npm packages - first time takes a minute)"
Set-Location $Frontend
if (-not (Test-Path (Join-Path $Frontend ".env"))) { Copy-Item ".env.example" ".env" }
& npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Fail "npm install failed. Scroll up for the error." }
Ok "Website packages installed"

Set-Location $Root
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Setup complete!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Start the store any time with:  start.bat  (or .\start.ps1)"
Write-Host ""
Write-Host " Demo logins (for local testing only):"
Write-Host "   Admin     http://localhost:5173/admin"
Write-Host "             admin@demo.glassstore.in  /  Admin@123456"
Write-Host "   Customer  http://localhost:5173/login"
Write-Host "             customer@demo.glassstore.in  /  Customer@123456"
Write-Host ""
$ans = Read-Host "Start the store now? (Y/n)"
if ($ans -eq "" -or $ans -match "^[Yy]") { & (Join-Path $Root "start.ps1") }
