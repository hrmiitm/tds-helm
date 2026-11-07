<#
.SYNOPSIS
    Web-Only Mode Installer for Studio Universal (PowerShell).
.DESCRIPTION
    Conforms to upgrade.md Section 8.1 & Section 8.3 (Steps W01 to W11).
    PowerShell 5.1/7+ compatible. Zero emojis.
#>

[CmdletBinding()]
param(
    [string]$Bind = "127.0.0.1",
    [string]$Port = "8080",
    [string]$PublicOrigin = "",
    [string]$WorkspaceOrigin = "",
    [string]$CoursesDir = "",

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
Usage: install-web-only.ps1 [-Bind <addr>] [-Port <port>] [-PublicOrigin <url>] [-WorkspaceOrigin <url>] [-CoursesDir <path>] [-Engine <auto|docker|podman>] [-Context <name>] [-ImageSource <auto|pull|build>] [-Offline] [-DryRun] [-Json] [-Help]

Installs and launches Studio Universal in Web-Only Mode (Section 8.3).
Does not require host Node, npm, Electron, or Python.

Parameters:
  -Bind <address>                 Bind address (default: 127.0.0.1)
  -Port <port>                    Public service port (default: 8080)
  -PublicOrigin <url>            Origin for catalog and control plane
  -WorkspaceOrigin <url>         Origin for active workspace iframe
  -CoursesDir <path>             Path to course content directories
  -Engine <auto|docker|podman>    Container engine to use (default: auto)
  -Context <name>                 Docker context or Podman connection name
  -ImageSource <auto|pull|build> Strategy for resolving hub image (default: auto)
  -Offline                        Forbid downloads and remote image builds
  -DryRun                         Perform preflight inventory without mutations
  -Json                           Output summary in JSON format
  -Help                           Show this help message and exit
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

if ([string]::IsNullOrEmpty($CoursesDir)) {
    $CoursesDir = Join-Path -Path $ScriptDir -ChildPath "courses"
}
if ([string]::IsNullOrEmpty($PublicOrigin)) {
    $PublicOrigin = "http://localhost:$Port"
}
if ([string]::IsNullOrEmpty($WorkspaceOrigin)) {
    $WorkspaceOrigin = "http://127.0.0.1:$Port"
}

$StateDir = Get-EngineStateDir
$LockAcquired = $false

function Finalize-WebInstall {
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

    # W02: Engine checks without requiring host Node/npm/Python
    $plat = Get-EnginePlatform
    if ($plat.Arch -ne "amd64" -and $plat.Arch -ne "arm64") {
        Write-EngineLog -Level "Error" -Message "Unsupported architecture '$($plat.Arch)'."
        exit $script:EXIT_PREREQ
    }

    $engInfo = Resolve-Engine -EnginePref $Engine -ContextPref $Context -StateDir $StateDir
    $EngineBin = $engInfo.Bin
    $EngineContext = $engInfo.Context

    # Validate courses
    $courseCount = 0
    if (Test-Path -LiteralPath $CoursesDir) {
        $found = Get-ChildItem -Path $CoursesDir -Directory | Where-Object { Test-Path (Join-Path $_.FullName "course.yaml") }
        $courseCount = $found.Count
    }
    if ($courseCount -eq 0) {
        Write-EngineLog -Level "Error" -Message "No valid courses found in $CoursesDir."
        exit $script:EXIT_IMAGE_BUILD
    }

    # W03: Resolve hub image
    $expectedHubImage = "rag-studio-hub:4.2.0"
    $ctxArgs = @()
    if (-not [string]::IsNullOrEmpty($EngineContext)) {
        if ($EngineBin -eq "docker") { $ctxArgs = @("--context", $EngineContext) }
        else { $ctxArgs = @("--connection", $EngineContext) }
    }

    $qArgs = $ctxArgs + @("images", "-q", $expectedHubImage)
    $qOutput = & $EngineBin @qArgs 2>$null
    $hubImageExists = ($null -ne $qOutput -and $qOutput.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($qOutput[0]))

    if ($hubImageExists) {
        Write-EngineLog -Level "Ok" -Message "Found existing hub image: $expectedHubImage"
    } else {
        if ($Offline) {
            Write-EngineLog -Level "Error" -Message "Offline mode: Hub image '$expectedHubImage' not found locally."
            exit $script:EXIT_IMAGE_BUILD
        }
        $hubDockerFile = Join-Path -Path $ScriptDir -ChildPath "orchestrator\Dockerfile"
        if ($DryRun) {
            Write-EngineLog -Level "Info" -Message "Dry run: Hub image '$expectedHubImage' would be built from orchestrator\Dockerfile."
        } else {
            if (-not (Test-Path -LiteralPath $hubDockerFile)) {
                Write-EngineLog -Level "Error" -Message "orchestrator\Dockerfile not found."
                exit $script:EXIT_IMAGE_BUILD
            }
            Write-EngineLog -Level "Step" -Message "Building hub image '$expectedHubImage'..."
            $buildArgs = $ctxArgs + @("build", "-t", $expectedHubImage, "-f", $hubDockerFile, $ScriptDir)
            & $EngineBin @buildArgs
            if ($LASTEXITCODE -ne 0) {
                Write-EngineLog -Level "Error" -Message "Failed to build hub image '$expectedHubImage'."
                exit $script:EXIT_IMAGE_BUILD
            }
        }
    }

    # W05: Validate bind and origins
    $isLoopback = ($Bind -eq "127.0.0.1" -or $Bind -eq "localhost" -or $Bind -eq "::1")
    if (-not $isLoopback) {
        if ($PublicOrigin -eq $WorkspaceOrigin) {
            Write-EngineLog -Level "Error" -Message "Non-loopback bind requires two distinct origins (-PublicOrigin and -WorkspaceOrigin)."
            exit $script:EXIT_CONFLICT
        }
        if (-not $PublicOrigin.StartsWith("https://")) {
            Write-EngineLog -Level "Error" -Message "Non-loopback bind requires explicitly configured TLS ingress (https://)."
            exit $script:EXIT_CONFLICT
        }
    }

    # W06: Labeled state volume and network
    $stateVolume = "rag-orchestrator-state-$InstallationId"
    $networkName = "rag-studio-net"

    if ($DryRun) {
        Write-EngineLog -Level "Info" -Message "Dry run: State volume '$stateVolume' and network '$networkName' would be created/reused."
        Write-EngineLog -Level "Info" -Message "Dry run: Hub container would be started on ${Bind}:${Port} with limits 0.5 CPU / 256 MiB."
    } else {
        # Create volume
        $volInspectArgs = $ctxArgs + @("volume", "inspect", $stateVolume)
        & $EngineBin @volInspectArgs 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-EngineLog -Level "Step" -Message "Creating state volume '$stateVolume'..."
            $volCreateArgs = $ctxArgs + @("volume", "create", "--label", "io.studio.managed=true", "--label", "io.studio.installation=$InstallationId", "--label", "io.studio.role=state", $stateVolume)
            & $EngineBin @volCreateArgs | Out-Null
        }

        # Create network
        $netInspectArgs = $ctxArgs + @("network", "inspect", $networkName)
        & $EngineBin @netInspectArgs 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-EngineLog -Level "Step" -Message "Creating network '$networkName'..."
            $netCreateArgs = $ctxArgs + @("network", "create", "--label", "io.studio.managed=true", "--label", "io.studio.installation=$InstallationId", "--label", "io.studio.role=network", $networkName)
            & $EngineBin @netCreateArgs | Out-Null
        }

        # W07: Bootstrap secret
        $tokenFile = Join-Path -Path $StateDir -ChildPath "bootstrap_token"
        $bootstrapToken = ""
        if (Test-Path -LiteralPath $tokenFile) {
            $bootstrapToken = (Get-Content -LiteralPath $tokenFile -TotalCount 1).Trim()
        }
        if ([string]::IsNullOrEmpty($bootstrapToken)) {
            $bootstrapToken = [System.Guid]::NewGuid().ToString("N") + [System.Guid]::NewGuid().ToString("N")
            Set-Content -LiteralPath $tokenFile -Value $bootstrapToken -Encoding UTF8 -Force
        }

        # W09: Start hub container
        $hubContainer = "rag-studio-hub"
        $rmArgs = $ctxArgs + @("rm", "-f", $hubContainer)
        & $EngineBin @rmArgs 2>$null

        Write-EngineLog -Level "Step" -Message "Starting orchestrator hub container on ${Bind}:${Port}..."
        $runArgs = $ctxArgs + @(
            "run", "-d",
            "--name", $hubContainer,
            "--label", "io.studio.managed=true",
            "--label", "io.studio.installation=$InstallationId",
            "--label", "io.studio.role=hub",
            "--cpus=0.5",
            "--memory=256m",
            "--restart", "unless-stopped",
            "--network", $networkName,
            "-p", "${Bind}:${Port}:8080",
            "-v", "${stateVolume}:/data",
            "-v", "${CoursesDir}:/opt/studio/courses:ro",
            "-e", "STUDIO_INSTALLATION_ID=$InstallationId",
            "-e", "STUDIO_PUBLIC_ORIGIN=$PublicOrigin",
            "-e", "STUDIO_WORKSPACE_ORIGIN=$WorkspaceOrigin",
            "-e", "STUDIO_BOOTSTRAP_TOKEN=$bootstrapToken",
            $expectedHubImage
        )
        & $EngineBin @runArgs | Out-Null

        # W10: Poll readiness
        Write-EngineLog -Level "Step" -Message "Waiting for orchestrator readiness probe..."
        $ready = $false
        for ($i = 0; $i -lt 30; $i++) {
            try {
                $req = [System.Net.WebRequest]::Create("http://${Bind}:${Port}/orchestrator/health/ready")
                $req.Timeout = 1500
                $resp = $req.GetResponse()
                if ($resp.StatusCode -eq 200) {
                    $ready = $true
                    $resp.Close()
                    break
                }
                $resp.Close()
            } catch {
                Start-Sleep -Seconds 2
            }
        }
        if (-not $ready) {
            Write-EngineLog -Level "Error" -Message "Hub container readiness probe timed out."
            exit $script:EXIT_PARTIAL
        }
    }

    # W11: Summary
    $catalogUrl = "$PublicOrigin/"
    if ($Json) {
        $outObj = @{
            status = "success"
            mode = "web-only"
            dryRun = [bool]$DryRun
            catalogUrl = $catalogUrl
            publicOrigin = $PublicOrigin
            workspaceOrigin = $WorkspaceOrigin
            engine = $EngineBin
            installationId = $InstallationId
            stateVolume = $stateVolume
            courses = $courseCount
        }
        $outObj | ConvertTo-Json -Depth 4
    } else {
        Write-Host "`n========================================================"
        Write-Host " Studio Universal -- Web-Only Hub Ready"
        Write-Host " Status:            $(if ($DryRun) { 'DRY RUN COMPLETE' } else { 'ACTIVE' })"
        Write-Host " Mode:              Web Gateway & Hub"
        Write-Host " Catalog URL:       $catalogUrl"
        Write-Host " Public Origin:     $PublicOrigin"
        Write-Host " Workspace Origin:  $WorkspaceOrigin"
        Write-Host " Engine:            $EngineBin"
        Write-Host " State Volume:      $stateVolume"
        Write-Host " Running Chapters:  0 (clean catalog start)"
        Write-Host " Stop Command:      $EngineBin stop rag-studio-hub"
        Write-Host " Restart Command:   $EngineBin restart rag-studio-hub"
        Write-Host "========================================================`n"
        Write-EngineLog -Level "Ok" -Message "Web-only hub installation complete."
    }

    exit $script:EXIT_SUCCESS

} finally {
    Finalize-WebInstall
}
