# ==============================================================================
# setup.ps1 — Universal Quick-Start Launcher for Studio Universal & Labs
# Supports: Windows 10/11 (PowerShell 5.1+, PowerShell 7+)
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

$ImageName = "rag-studio:4.2.0"
$GatewayPort = 8080
$GatewayUrl = "http://127.0.0.1:$GatewayPort"

function Write-Info($msg) { Write-Host "[setup] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "[setup:ok] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[setup:warn] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[setup:error] $msg" -ForegroundColor Red }

Write-Host "======================================================================" -ForegroundColor White
Write-Host " Studio Universal v4.2 — Quick Start & Unified Lab Environment" -ForegroundColor White
Write-Host " Foundations of RAG & Vector Databases" -ForegroundColor White
Write-Host "======================================================================" -ForegroundColor White

# Step 1: Detect container engine
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err "Docker was not found in PATH."
    Write-Err "Please install Docker Desktop for Windows (https://www.docker.com/products/docker-desktop/) and retry."
    exit 3
}

try {
    $null = docker info 2>&1
    Write-Success "Docker engine verified."
} catch {
    Write-Err "Docker is installed but the Docker daemon / Docker Desktop is not running."
    Write-Err "Please start Docker Desktop and retry."
    exit 4
}

# Step 2: Check Node.js and npm
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Err "Node.js and npm are required on the host to run the controller and client."
    Write-Err "Please install Node.js 18+ (https://nodejs.org/) and retry."
    exit 3
}
$nodeVer = node -v
Write-Success "Node.js runtime verified: $nodeVer"

# Step 3: Check / Build Container Image
Write-Info "Checking runtime image '$ImageName'..."
$imgCheck = docker images -q $ImageName
if (-not $imgCheck) {
    Write-Warn "Runtime image '$ImageName' not found locally. Initiating automated build..."
    docker build -t $ImageName .
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Docker build failed."
        exit 5
    }
    Write-Success "Container image built successfully: $ImageName"
} else {
    Write-Success "Runtime image found: $ImageName"
}

# Step 4: Build Host Orchestrator Controller
Write-Info "Ensuring orchestrator controller is built..."
Push-Location "orchestrator"
try {
    if (-not (Test-Path "node_modules")) {
        npm install --no-audit --no-fund
    }
    npm run build --silent
} finally {
    Pop-Location
}
Write-Success "Orchestrator build complete."

# Step 5: Ensure Desktop Client dependencies are installed
Write-Info "Ensuring desktop application dependencies are ready..."
Push-Location "desktop-app"
try {
    if (-not (Test-Path "node_modules")) {
        npm install --no-audit --no-fund
    }
} finally {
    Pop-Location
}
Write-Success "Desktop dependencies ready."

# Step 6: Start Host Orchestrator in Background
$OrchestratorProcess = $null
$isOrchAlive = $false
try {
    $resp = Invoke-WebRequest -Uri "$GatewayUrl/orchestrator/health/live" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($resp.StatusCode -eq 200) { $isOrchAlive = $true }
} catch {}

if ($isOrchAlive) {
    Write-Success "Orchestrator is already active on $GatewayUrl."
} else {
    Write-Info "Starting background orchestrator on $GatewayUrl..."
    $OrchestratorProcess = Start-Process -FilePath "node" -ArgumentList "orchestrator/dist/server.js" -PassThru -NoNewWindow
    
    $ready = $false
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Seconds 1
        try {
            $resp = Invoke-WebRequest -Uri "$GatewayUrl/orchestrator/health/live" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($resp.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {}
    }

    if (-not $ready) {
        Write-Err "Orchestrator failed to become healthy within 25 seconds."
        if ($OrchestratorProcess) { Stop-Process -Id $OrchestratorProcess.Id -Force -ErrorAction SilentlyContinue }
        exit 5
    }
    Write-Success "Orchestrator gateway is active on $GatewayUrl."
}

# Step 7: Launch Application
$env:RAG_STUDIO_URL = $GatewayUrl

try {
    Write-Success "Launching native Electron desktop app..."
    Push-Location "desktop-app"
    try {
        npx electron .
    } finally {
        Pop-Location
    }
} finally {
    if ($OrchestratorProcess -and -not $OrchestratorProcess.HasExited) {
        Write-Info "Stopping background orchestrator..."
        Stop-Process -Id $OrchestratorProcess.Id -Force -ErrorAction SilentlyContinue
    }
}

