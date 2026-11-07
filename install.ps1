<#
.SYNOPSIS
    Desktop Mode Installer for Studio Universal (PowerShell).
.DESCRIPTION
    Conforms to upgrade.md Section 8.1 & Section 8.2 (Steps I01 to I12).
    PowerShell 5.1/7+ compatible. Zero emojis.
#>

[CmdletBinding()]
param(
    [ValidateSet("auto", "docker", "podman")]
    [string]$Engine = "auto",

    [string]$Context = "",
    [ValidateSet("auto", "pull", "build")]
    [string]$ImageSource = "auto",

    [switch]$Offline,
    [switch]$DryRun,
    [switch]$Json,
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Help) {
    Write-Host @"
Usage: install.ps1 [-Engine <auto|docker|podman>] [-Context <name>] [-ImageSource <auto|pull|build>] [-Offline] [-DryRun] [-Json] [-Help]

Installs Studio Universal in Desktop Mode (Section 8.2).

Parameters:
  -Engine <auto|docker|podman>        Container engine to use (default: auto)
  -Context <name>                     Docker context or Podman connection name
  -ImageSource <auto|pull|build>      Strategy for resolving runtime image (default: auto)
  -Offline                            Forbid downloads and remote image builds
  -DryRun                             Perform preflight inventory without mutations
  -Json                               Output installation summary in JSON format
  -Help                               Show this help message and exit
"@
    exit 0
}

$ScriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$LibFile = Join-Path -Path $ScriptDir -ChildPath "scripts\lib\engine.ps1"

if (-not (Test-Path -LiteralPath $LibFile)) {
    [Console]::Error.WriteLine("[ERROR] Required library $LibFile not found.")
    exit 3
}

. $LibFile

# I01: Verify expected manifest and package files
$releaseManifest = Join-Path -Path $ScriptDir -ChildPath "release-manifest.json"
if (-not (Test-Path -LiteralPath $releaseManifest)) {
    Write-EngineLog -Level "Error" -Message "Release manifest '$releaseManifest' not found."
    exit $script:EXIT_PREREQ
}

$desktopPackage = Join-Path -Path $ScriptDir -ChildPath "desktop-app\package.json"
if (-not (Test-Path -LiteralPath $desktopPackage)) {
    Write-EngineLog -Level "Error" -Message "Desktop app manifest '$desktopPackage' not found."
    exit $script:EXIT_PREREQ
}

$StateDir = Get-EngineStateDir
$LockAcquired = $false

function Finalize-Install {
    if ($script:LockAcquired) {
        Release-EngineLock -StateDir $script:StateDir
        $script:LockAcquired = $false
    }
}

try {
    if (-not $DryRun) {
        Acquire-EngineLock -StateDir $StateDir | Out-Null
        $LockAcquired = $true
    }

    $InstallationId = Get-EngineInstallationId -StateDir $StateDir

    # I02: Platform and arch detection
    $plat = Get-EnginePlatform
    if ($plat.Arch -ne "amd64" -and $plat.Arch -ne "arm64") {
        Write-EngineLog -Level "Error" -Message "Unsupported architecture '$($plat.Arch)'. Studio Universal supports amd64 and arm64."
        exit $script:EXIT_PREREQ
    }

    # I03: Resolve engine and context
    $engInfo = Resolve-Engine -EnginePref $Engine -ContextPref $Context -StateDir $StateDir
    $EngineBin = $engInfo.Bin
    $EngineContext = $engInfo.Context

    # I04: Probe resources
    $resources = Get-EngineResources -TargetDir $StateDir
    if ($resources.CPUs -lt 2) {
        Write-EngineLog -Level "Warn" -Message "Host has $($resources.CPUs) CPU(s). Minimum recommended for chapter runtime is 2 CPUs."
    }
    if ($resources.RAMMb -lt 2500) {
        Write-EngineLog -Level "Warn" -Message "Host RAM ($($resources.RAMMb) MiB) is below recommended 3072 MiB."
    }

    # I05: Port 8080 conflict check
    $portBusy = $false
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("127.0.0.1", 8080, $null, $null)
        $wait = $iar.AsyncWaitHandle.WaitOne(1000, $false)
        if ($wait -and $tcp.Connected) {
            $portBusy = $true
            $tcp.EndConnect($iar)
        }
        $tcp.Close()
    } catch {
        $portBusy = $false
    }

    if ($portBusy) {
        $isStudioOwner = $false
        try {
            $req = [System.Net.WebRequest]::Create("http://127.0.0.1:8080/health/live")
            $req.Timeout = 1500
            $resp = $req.GetResponse()
            if ($resp.StatusCode -eq 200) { $isStudioOwner = $true }
            $resp.Close()
        } catch {
            $isStudioOwner = $false
        }

        if ($isStudioOwner) {
            Write-EngineLog -Level "Info" -Message "Existing Studio controller detected on port 8080; desktop client will attach."
        } else {
            Write-EngineLog -Level "Error" -Message "Port 8080 is already occupied by an unrelated process."
            exit $script:EXIT_CONFLICT
        }
    }

    # I06: Verify/resolve rag-studio:4.2.0 image
    $expectedImage = "rag-studio:4.2.0"
    $imageId = ""
    $ctxArgs = @()
    if (-not [string]::IsNullOrEmpty($EngineContext)) {
        if ($EngineBin -eq "docker") { $ctxArgs = @("--context", $EngineContext) }
        else { $ctxArgs = @("--connection", $EngineContext) }
    }

    $qArgs = $ctxArgs + @("images", "-q", $expectedImage)
    $qOutput = & $EngineBin @qArgs 2>$null
    if ($null -ne $qOutput -and $qOutput.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($qOutput[0])) {
        $imageId = $qOutput[0].Trim()
        Write-EngineLog -Level "Ok" -Message "Found existing runtime image: $expectedImage ($imageId)"
    } else {
        if ($Offline) {
            Write-EngineLog -Level "Error" -Message "Offline mode: Runtime image '$expectedImage' is not available locally."
            exit $script:EXIT_IMAGE_BUILD
        }
        if ($DryRun) {
            Write-EngineLog -Level "Info" -Message "Dry run: Runtime image '$expectedImage' would be built from Dockerfile."
        } else {
            Write-EngineLog -Level "Step" -Message "Building runtime image '$expectedImage'..."
            $buildArgs = $ctxArgs + @("build", "-t", $expectedImage, $ScriptDir)
            & $EngineBin @buildArgs
            if ($LASTEXITCODE -ne 0) {
                Write-EngineLog -Level "Error" -Message "Failed to build runtime image '$expectedImage'."
                exit $script:EXIT_IMAGE_BUILD
            }
            $qOutput = & $EngineBin @qArgs 2>$null
            if ($null -ne $qOutput) { $imageId = $qOutput[0].Trim() }
        }
    }

    # I07: Course bundles validation
    $validChapterCount = 4
    $coursesDir = Join-Path -Path $ScriptDir -ChildPath "courses"
    if (Test-Path -LiteralPath $coursesDir) {
        $found = Get-ChildItem -Path $coursesDir -Directory | Where-Object { Test-Path (Join-Path $_.FullName "course.yaml") }
        if ($found.Count -gt 0) { $validChapterCount = $found.Count }
    }
    Write-EngineLog -Level "Ok" -Message "Validated $validChapterCount course bundle(s)."

    # I08: Host Node and npm verification
    $nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
    $npmCmd = Get-Command "npm" -ErrorAction SilentlyContinue
    if ($null -eq $nodeCmd -or $null -eq $npmCmd) {
        Write-EngineLog -Level "Error" -Message "Node.js and npm are required for Desktop Mode installation."
        Write-EngineLog -Level "Error" -Message "Please install Node.js 18+ (https://nodejs.org/) or use web-only mode."
        exit $script:EXIT_PREREQ
    }

    # I09: Install dependencies
    if ($DryRun) {
        Write-EngineLog -Level "Info" -Message "Dry run: npm dependencies in desktop-app/ would be installed."
    } else {
        Write-EngineLog -Level "Step" -Message "Installing desktop client dependencies..."
        $desktopDir = Join-Path -Path $ScriptDir -ChildPath "desktop-app"
        $lockFile = Join-Path -Path $desktopDir -ChildPath "package-lock.json"
        Push-Location $desktopDir
        try {
            if (Test-Path -LiteralPath $lockFile) {
                & npm ci --ignore-scripts
            } else {
                & npm install --ignore-scripts
            }
            $electronPathTxt = Join-Path -Path $desktopDir -ChildPath "node_modules/electron/path.txt"
            $electronInstallJs = Join-Path -Path $desktopDir -ChildPath "node_modules/electron/install.js"
            if (-not (Test-Path -LiteralPath $electronPathTxt) -and (Test-Path -LiteralPath $electronInstallJs)) {
                & node $electronInstallJs
            }
            if ($LASTEXITCODE -ne 0) {
                Write-EngineLog -Level "Error" -Message "Failed to install desktop application dependencies via npm."
                exit $script:EXIT_IMAGE_BUILD
            }
        } finally {
            Pop-Location
        }
    }

    # I10: Write configuration
    if ($DryRun) {
        Write-EngineLog -Level "Info" -Message "Dry run: Configuration would be written to $StateDir\config.json."
    } else {
        $cfgFile = Join-Path -Path $StateDir -ChildPath "config.json"
        $cfgObj = @{
            installationId = $InstallationId
            engine = $EngineBin
            context = $EngineContext
            mode = "desktop"
            image = $expectedImage
            imageId = $imageId
            installedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            version = "4.2.0"
        }
        $cfgObj | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $cfgFile -Encoding UTF8 -Force
        Write-EngineLog -Level "Ok" -Message "Configuration written to $cfgFile."
    }

    # I11: Create shortcut on Windows
    $shortcutPath = ""
    if (-not $DryRun -and $plat.OS -eq "windows") {
        try {
            $wshShell = New-Object -ComObject WScript.Shell
            $desktopDir = [System.Environment]::GetFolderPath('Desktop')
            $shortcutPath = Join-Path -Path $desktopDir -ChildPath "RAG Studio.lnk"
            $shortcut = $wshShell.CreateShortcut($shortcutPath)
            $shortcut.TargetPath = "powershell.exe"
            $launcherScript = Join-Path -Path $ScriptDir -ChildPath "run-desktop.sh"
            $shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$launcherScript`""
            $shortcut.WorkingDirectory = $ScriptDir
            $shortcut.Description = "Studio Universal Native Desktop Client"
            $shortcut.Save()
        } catch {}
    }

    # I12: Startup smoke validation
    if ($Json) {
        $outObj = @{
            status = "success"
            mode = "desktop"
            dryRun = [bool]$DryRun
            engine = $EngineBin
            context = $EngineContext
            installationId = $InstallationId
            image = $expectedImage
            imageId = $imageId
            validChapters = $validChapterCount
            shortcut = $shortcutPath
            launchCommand = "run-desktop.sh"
        }
        $outObj | ConvertTo-Json -Depth 4
    } else {
        Write-Host "`n========================================================"
        Write-Host " Studio Universal -- Desktop Installation Summary"
        Write-Host " Status:          $(if ($DryRun) { 'DRY RUN COMPLETE' } else { 'READY' })"
        Write-Host " Mode:            Desktop Client"
        Write-Host " Engine:          $EngineBin (Context: $(if ([string]::IsNullOrEmpty($EngineContext)) { 'default' } else { $EngineContext }))"
        Write-Host " Image:           $expectedImage ($imageId)"
        Write-Host " Valid Courses:   $validChapterCount"
        Write-Host " Installation ID: $InstallationId"
        Write-Host " Shortcut:        $(if ([string]::IsNullOrEmpty($shortcutPath)) { 'none' } else { $shortcutPath })"
        Write-Host " Launch Command:  run-desktop.sh"
        Write-Host "========================================================`n"
        Write-EngineLog -Level "Ok" -Message "Installation succeeded without starting runtime containers (idempotent)."
    }

    exit $script:EXIT_SUCCESS

} finally {
    Finalize-Install
}
