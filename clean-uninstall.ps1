<#
.SYNOPSIS
    Clean uninstaller for Studio Universal (PowerShell).
.DESCRIPTION
    Safely uninstalls Studio Universal containers, volumes, dependencies, and shortcuts.
    Conforms to upgrade.md Section 8.1 & Section 8.4. Zero emojis.
#>

[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [ValidateSet("auto", "docker", "podman")]
    [string]$Engine = "auto",

    [string]$Context = "",
    [switch]$PurgeImages,
    [switch]$Yes,
    [switch]$IncludeLegacy,
    [switch]$AllInstallations,
    [switch]$DryRun,
    [switch]$Json,
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Help) {
    Write-Host @"
Usage: clean-uninstall.ps1 [-Engine <auto|docker|podman>] [-Context <name>] [-PurgeImages] [-Yes] [-IncludeLegacy] [-AllInstallations] [-DryRun] [-Json] [-Help]

Safely uninstalls Studio Universal containers, volumes, dependencies, and shortcuts.

Parameters:
  -Engine <auto|docker|podman>  Container engine to use (default: auto)
  -Context <name>               Docker context or Podman connection name
  -PurgeImages                  Also remove rag-studio:* and rag-studio-hub:* images
  -Yes                          Non-interactive confirmation for targeted deletion
  -IncludeLegacy                Include unlabeled legacy containers and volumes
  -AllInstallations             Target all Studio Universal installations on engine
  -DryRun / -WhatIf             Print inventory of targets without modifying anything
  -Json                         Output inventory and report in JSON format
  -Help                         Show this help message and exit
"@
    exit 0
}

# Honor -WhatIf if passed via CmdletBinding
if ($PSCmdlet.ParameterSetName -eq "" -and $WhatIfPreference) {
    $DryRun = $true
}

$ScriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$LibFile = Join-Path -Path $ScriptDir -ChildPath "scripts\lib\engine.ps1"

if (-not (Test-Path -LiteralPath $LibFile)) {
    [Console]::Error.WriteLine("[ERROR] Required library $LibFile not found.")
    exit 3
}

. $LibFile

$StateDir = Get-EngineStateDir
$LockAcquired = $false

function Finalize-Cleanup {
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

    $InstallationId = ""
    $idFile = Join-Path -Path $StateDir -ChildPath "installation_id"
    if (Test-Path -LiteralPath $idFile) {
        $InstallationId = (Get-Content -LiteralPath $idFile -TotalCount 1).Trim()
    }

    $engInfo = Resolve-Engine -EnginePref $Engine -ContextPref $Context -StateDir $StateDir
    $EngineBin = $engInfo.Bin
    $EngineContext = $engInfo.Context

    # U02 & U03: Inventory candidates
    $allContainers = Get-StudioContainers -EngineBin $EngineBin -Context $EngineContext
    $targetContainers = @()
    $targetContainerNames = @()
    $skippedContainers = @()

    foreach ($c in $allContainers) {
        $isTarget = $false
        if ($c.Managed) {
            if ($AllInstallations -or [string]::IsNullOrEmpty($InstallationId) -or ($c.Installation -eq $InstallationId)) {
                $isTarget = $true
            } else {
                $skippedContainers += "$($c.Name) (belongs to installation $($c.Installation))"
            }
        } else {
            if ($c.Name -like "rag-studio*" -or $c.Name -like "studio-*") {
                if ($IncludeLegacy) {
                    $isTarget = $true
                } else {
                    $skippedContainers += "$($c.Name) (unlabeled legacy container; requires -IncludeLegacy)"
                }
            }
        }

        if ($isTarget) {
            $targetContainers += $c.ID
            $targetContainerNames += $c.Name
        }
    }

    $allVolumes = Get-StudioVolumes -EngineBin $EngineBin -Context $EngineContext
    $targetVolumes = @()
    $skippedVolumes = @()

    foreach ($v in $allVolumes) {
        $isTarget = $false
        if ($v.Managed) {
            if ($AllInstallations -or [string]::IsNullOrEmpty($InstallationId) -or ($v.Installation -eq $InstallationId)) {
                $isTarget = $true
            } else {
                $skippedVolumes += "$($v.Name) (belongs to installation $($v.Installation))"
            }
        } else {
            if ($v.Name -like "rag-studio-*" -or $v.Name -like "rag-workspace-*" -or $v.Name -like "rag-user-*" -or $v.Name -like "rag-orchestrator-state-*") {
                if ($IncludeLegacy) {
                    $isTarget = $true
                } else {
                    $skippedVolumes += "$($v.Name) (unlabeled legacy volume; requires -IncludeLegacy)"
                }
            }
        }

        if ($isTarget) {
            $targetVolumes += $v.Name
        }
    }

    $allNetworks = Get-StudioNetworks -EngineBin $EngineBin -Context $EngineContext
    $targetNetworks = @()
    foreach ($n in $allNetworks) {
        if ($n.Managed) {
            if ($AllInstallations -or [string]::IsNullOrEmpty($InstallationId) -or ($n.Installation -eq $InstallationId)) {
                $targetNetworks += $n.ID
            }
        } elseif ($IncludeLegacy -and $n.Name -eq "rag-studio-net") {
            $targetNetworks += $n.ID
        }
    }

    $allImages = Get-StudioImages -EngineBin $EngineBin -Context $EngineContext
    $targetImages = @()
    $preservedImages = @()
    foreach ($img in $allImages) {
        if ($img.Tag -like "rag-studio:*" -or $img.Tag -like "rag-studio-hub:*") {
            if ($PurgeImages) {
                $targetImages += $img.Tag
            } else {
                $preservedImages += $img.Tag
            }
        }
    }

    $targetPaths = @()
    $desktopAppModules = Join-Path -Path $ScriptDir -ChildPath "desktop-app\node_modules"
    if (Test-Path -LiteralPath $desktopAppModules) { $targetPaths += $desktopAppModules }

    $desktopAppDist = Join-Path -Path $ScriptDir -ChildPath "desktop-app\dist"
    if (Test-Path -LiteralPath $desktopAppDist) { $targetPaths += $desktopAppDist }

    $orchestratorModules = Join-Path -Path $ScriptDir -ChildPath "orchestrator\node_modules"
    if (Test-Path -LiteralPath $orchestratorModules) { $targetPaths += $orchestratorModules }

    if (Test-Path -LiteralPath $StateDir) { $targetPaths += $StateDir }

    if ($Json) {
        $reportObj = @{
            dryRun = [bool]$DryRun
            engine = $EngineBin
            installationId = $InstallationId
            targetContainers = $targetContainerNames
            skippedContainers = $skippedContainers
            targetVolumes = $targetVolumes
            skippedVolumes = $skippedVolumes
            targetNetworks = $targetNetworks
            targetImages = $targetImages
            preservedImages = $preservedImages
            targetPaths = $targetPaths
        }
        $reportObj | ConvertTo-Json -Depth 5
        if ($DryRun) { exit $script:EXIT_SUCCESS }
    } else {
        Write-Host "========================================================"
        Write-Host " Studio Universal -- Clean Uninstallation Inventory"
        Write-Host " Engine:          $EngineBin"
        Write-Host " Installation ID: $(if ([string]::IsNullOrEmpty($InstallationId)) { '[none / unmanaged]' } else { $InstallationId })"
        Write-Host " Mode:            $(if ($DryRun) { 'DRY RUN (read-only)' } else { 'EXECUTION' })"
        Write-Host "========================================================`n"

        Write-Host "[INVENTORY] Managed & Targeted Containers ($($targetContainers.Count)):"
        if ($targetContainerNames.Count -eq 0) { Write-Host "  (none)" }
        else { foreach ($cn in $targetContainerNames) { Write-Host "  - $cn" } }

        if ($skippedContainers.Count -gt 0) {
            Write-Host "`n[INVENTORY] Skipped Containers ($($skippedContainers.Count)):"
            foreach ($sc in $skippedContainers) { Write-Host "  * $sc" }
        }

        Write-Host "`n[INVENTORY] Managed & Targeted Volumes ($($targetVolumes.Count)):"
        if ($targetVolumes.Count -eq 0) { Write-Host "  (none)" }
        else { foreach ($vn in $targetVolumes) { Write-Host "  - $vn" } }

        if ($skippedVolumes.Count -gt 0) {
            Write-Host "`n[INVENTORY] Skipped Volumes ($($skippedVolumes.Count)):"
            foreach ($sv in $skippedVolumes) { Write-Host "  * $sv" }
        }

        Write-Host "`n[INVENTORY] Targeted Networks ($($targetNetworks.Count)):"
        if ($targetNetworks.Count -eq 0) { Write-Host "  (none)" }
        else { foreach ($nn in $targetNetworks) { Write-Host "  - $nn" } }

        Write-Host "`n[INVENTORY] Images to Purge (-PurgeImages) ($($targetImages.Count)):"
        if ($targetImages.Count -eq 0) { Write-Host "  (none)" }
        else { foreach ($in in $targetImages) { Write-Host "  - $in" } }

        if ($preservedImages.Count -gt 0) {
            Write-Host "`n[INVENTORY] Preserved Images ($($preservedImages.Count)):"
            foreach ($pn in $preservedImages) { Write-Host "  * $pn" }
        }

        Write-Host "`n[INVENTORY] Targeted File System Artifacts ($($targetPaths.Count)):"
        if ($targetPaths.Count -eq 0) { Write-Host "  (none)" }
        else { foreach ($tp in $targetPaths) { Write-Host "  - $tp" } }
        Write-Host ""
    }

    if ($DryRun) {
        Write-EngineLog -Level "Info" -Message "Dry run complete. No modifications were made."
        exit $script:EXIT_SUCCESS
    }

    # U04: Confirmation check
    if (-not $Yes) {
        if (-not [Environment]::UserInteractive) {
            Write-EngineLog -Level "Error" -Message "Non-interactive execution requires explicit -Yes switch."
            exit $script:EXIT_CANCEL
        }

        Write-Host "WARNING: The items listed above will be PERMANENTLY DELETED."
        $confirm = Read-Host "To confirm uninstallation, type 'DELETE STUDIO'"
        if ($confirm -ne "DELETE STUDIO") {
            Write-EngineLog -Level "Info" -Message "Uninstallation cancelled by user."
            exit $script:EXIT_CANCEL
        }
    }

    $partialFailure = $false

    # U05: Stop containers
    if ($targetContainers.Count -gt 0) {
        Write-EngineLog -Level "Step" -Message "Stopping $($targetContainers.Count) container(s)..."
        foreach ($cid in $targetContainers) {
            $stopArgs = @("stop", "-t", "15", $cid)
            & $EngineBin @stopArgs 2>$null
            if ($LASTEXITCODE -ne 0) {
                $killArgs = @("kill", $cid)
                & $EngineBin @killArgs 2>$null
            }
        }
    }

    # U06: Remove containers
    if ($targetContainers.Count -gt 0) {
        Write-EngineLog -Level "Step" -Message "Removing $($targetContainers.Count) container(s)..."
        foreach ($cid in $targetContainers) {
            $rmArgs = @("rm", "-f", $cid)
            & $EngineBin @rmArgs 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-EngineLog -Level "Error" -Message "Failed to remove container $cid."
                $partialFailure = $true
            }
        }
    }

    # U07: Remove volumes and networks
    if ($targetVolumes.Count -gt 0) {
        Write-EngineLog -Level "Step" -Message "Removing $($targetVolumes.Count) volume(s)..."
        foreach ($vid in $targetVolumes) {
            $vrmArgs = @("volume", "rm", $vid)
            & $EngineBin @vrmArgs 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-EngineLog -Level "Error" -Message "Failed to remove volume $vid."
                $partialFailure = $true
            }
        }
    }

    if ($targetNetworks.Count -gt 0) {
        Write-EngineLog -Level "Step" -Message "Removing $($targetNetworks.Count) network(s)..."
        foreach ($nid in $targetNetworks) {
            $nrmArgs = @("network", "rm", $nid)
            & $EngineBin @nrmArgs 2>$null
        }
    }

    # U08: Remove local artifacts
    foreach ($p in $targetPaths) {
        if ($p -eq $ScriptDir -or $p -eq "C:\" -or $p -eq "/") {
            Write-EngineLog -Level "Error" -Message "Safety invariant violated: refusing to remove path $p"
            $partialFailure = $true
            continue
        }
        if (Test-Path -LiteralPath $p) {
            if ($p -eq $StateDir) {
                Release-EngineLock -StateDir $StateDir
                $LockAcquired = $false
            }
            Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    # U09: Purge images
    if ($PurgeImages -and $targetImages.Count -gt 0) {
        Write-EngineLog -Level "Step" -Message "Purging $($targetImages.Count) image(s)..."
        foreach ($img in $targetImages) {
            $rmiArgs = @("rmi", $img)
            & $EngineBin @rmiArgs 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-EngineLog -Level "Warn" -Message "Failed to remove image $img."
            }
        }
    }

    if ($partialFailure) {
        Write-EngineLog -Level "Error" -Message "Uninstallation completed with partial failures."
        exit $script:EXIT_PARTIAL
    }

    Write-EngineLog -Level "Ok" -Message "Studio Universal uninstallation completed successfully."
    exit $script:EXIT_SUCCESS

} finally {
    Finalize-Cleanup
}
