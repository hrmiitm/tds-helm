# scripts/lib/engine.ps1 -- Universal Engine Discovery and Resource Library for PowerShell
# Conforms to upgrade.md Section 4 & Section 8. PowerShell 5.1/7+ compatible. Zero emojis.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Exit codes per Section 8.1
$script:EXIT_SUCCESS = 0
$script:EXIT_USAGE = 2
$script:EXIT_PREREQ = 3
$script:EXIT_ENGINE = 4
$script:EXIT_IMAGE_BUILD = 5
$script:EXIT_CONFLICT = 6
$script:EXIT_CANCEL = 7
$script:EXIT_PARTIAL = 8

function Write-EngineLog {
    param(
        [Parameter(Mandatory=$true)]
        [ValidateSet("Info", "Step", "Ok", "Warn", "Error")]
        [string]$Level,
        [Parameter(Mandatory=$true)]
        [string]$Message
    )

    switch ($Level) {
        "Info"  { Write-Host "[INFO] $Message" }
        "Step"  { Write-Host "[STEP] $Message" }
        "Ok"    { Write-Host "[OK] $Message" }
        "Warn"  { Write-Warning "[WARN] $Message" }
        "Error" { [Console]::Error.WriteLine("[ERROR] $Message") }
    }
}

function Get-EnginePlatform {
    $osName = "windows"
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        if ($IsLinux) { $osName = "linux" }
        elseif ($IsMacOS) { $osName = "darwin" }
        elseif ($IsWindows) { $osName = "windows" }
    } else {
        $osName = "windows"
    }

    $arch = "amd64"
    $envArch = $env:PROCESSOR_ARCHITECTURE
    if ($envArch -eq "ARM64") {
        $arch = "arm64"
    }

    return @{
        OS = $osName
        Arch = $arch
    }
}

function Get-EngineStateDir {
    $plat = Get-EnginePlatform
    if ($plat.OS -eq "windows") {
        $base = $env:LOCALAPPDATA
        if ([string]::IsNullOrEmpty($base)) {
            $base = [System.IO.Path]::Combine($env:USERPROFILE, "AppData", "Local")
        }
        return [System.IO.Path]::Combine($base, "Studio Universal")
    } elseif ($plat.OS -eq "darwin") {
        $home = [System.Environment]::GetFolderPath('UserProfile')
        return [System.IO.Path]::Combine($home, "Library", "Application Support", "Studio Universal")
    } else {
        $xdg = $env:XDG_STATE_HOME
        if ([string]::IsNullOrEmpty($xdg)) {
            $home = [System.Environment]::GetFolderPath('UserProfile')
            return [System.IO.Path]::Combine($home, ".local", "state", "studio-universal")
        }
        return [System.IO.Path]::Combine($xdg, "studio-universal")
    }
}

function Get-EngineInstallationId {
    param([string]$StateDir)

    if (-not (Test-Path -LiteralPath $StateDir)) {
        New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
    }

    $idFile = Join-Path -Path $StateDir -ChildPath "installation_id"
    if (Test-Path -LiteralPath $idFile) {
        $existing = (Get-Content -LiteralPath $idFile -TotalCount 1).Trim()
        if (-not [string]::IsNullOrEmpty($existing)) {
            return $existing
        }
    }

    $newId = [System.Guid]::NewGuid().ToString()
    Set-Content -LiteralPath $idFile -Value $newId -Encoding UTF8 -Force
    return $newId
}

function Acquire-EngineLock {
    param(
        [string]$StateDir,
        [string]$LockName = "setup.lock"
    )

    if (-not (Test-Path -LiteralPath $StateDir)) {
        New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
    }

    $lockDir = Join-Path -Path $StateDir -ChildPath $LockName
    try {
        New-Item -ItemType Directory -Path $lockDir -ErrorAction Stop | Out-Null
        $pidFile = Join-Path -Path $lockDir -ChildPath "pid"
        Set-Content -LiteralPath $pidFile -Value "$PID" -Encoding UTF8 -Force
        return $true
    } catch {
        # Check stale lock
        $pidFile = Join-Path -Path $lockDir -ChildPath "pid"
        if (Test-Path -LiteralPath $pidFile) {
            $oldPidStr = (Get-Content -LiteralPath $pidFile -TotalCount 1).Trim()
            $oldPid = 0
            if ([int]::TryParse($oldPidStr, [ref]$oldPid)) {
                $isRunning = $false
                try {
                    $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
                    if ($null -ne $proc) { $isRunning = $true }
                } catch {
                    $isRunning = $false
                }

                if (-not $isRunning) {
                    Write-EngineLog -Level "Warn" -Message "Reclaiming stale setup lock from inactive process PID: $oldPid"
                    Remove-Item -LiteralPath $lockDir -Recurse -Force -ErrorAction SilentlyContinue
                    New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
                    Set-Content -LiteralPath $pidFile -Value "$PID" -Encoding UTF8 -Force
                    return $true
                } else {
                    Write-EngineLog -Level "Error" -Message "Another setup or maintenance process is actively running (PID: $oldPid)."
                    exit $script:EXIT_CONFLICT
                }
            }
        }
        Write-EngineLog -Level "Error" -Message "Failed to acquire lock at $lockDir."
        exit $script:EXIT_CONFLICT
    }
}

function Release-EngineLock {
    param(
        [string]$StateDir,
        [string]$LockName = "setup.lock"
    )

    $lockDir = Join-Path -Path $StateDir -ChildPath $LockName
    if (Test-Path -LiteralPath $lockDir) {
        $pidFile = Join-Path -Path $lockDir -ChildPath "pid"
        if (Test-Path -LiteralPath $pidFile) {
            $holderPid = (Get-Content -LiteralPath $pidFile -TotalCount 1).Trim()
            if ($holderPid -eq "$PID") {
                Remove-Item -LiteralPath $lockDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        } else {
            Remove-Item -LiteralPath $lockDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Resolve-Engine {
    param(
        [string]$EnginePref = "auto",
        [string]$ContextPref = "",
        [string]$StateDir = ""
    )

    $savedEngine = ""
    $savedContext = ""
    if ($EnginePref -eq "auto" -and -not [string]::IsNullOrEmpty($StateDir)) {
        $cfgFile = Join-Path -Path $StateDir -ChildPath "config.json"
        if (Test-Path -LiteralPath $cfgFile) {
            try {
                $raw = Get-Content -LiteralPath $cfgFile -Raw | ConvertFrom-Json
                if ($null -ne $raw.engine) { $savedEngine = $raw.engine }
                if ($null -ne $raw.context) { $savedContext = $raw.context }
            } catch {}
        }
    }

    $candidates = @()
    if ($EnginePref -ne "auto") {
        $candidates = @($EnginePref)
    } elseif (-not [string]::IsNullOrEmpty($savedEngine)) {
        $candidates = @($savedEngine)
    } else {
        # Prefer reachable Docker first, then Podman
        $candidates = @("docker", "podman")
    }

    $selectedContext = $ContextPref
    if ([string]::IsNullOrEmpty($selectedContext) -and -not [string]::IsNullOrEmpty($savedContext)) {
        $selectedContext = $savedContext
    }

    $foundCli = $false
    $lastError = ""

    foreach ($eng in $candidates) {
        $cmd = Get-Command $eng -ErrorAction SilentlyContinue
        if ($null -eq $cmd) {
            if ($EnginePref -eq $eng) {
                Write-EngineLog -Level "Error" -Message "Requested engine '$eng' CLI was not found in PATH."
                exit $script:EXIT_PREREQ
            }
            continue
        }
        $foundCli = $true

        $ctxArgs = @()
        if (-not [string]::IsNullOrEmpty($selectedContext)) {
            if ($eng -eq "docker") { $ctxArgs = @("--context", $selectedContext) }
            elseif ($eng -eq "podman") { $ctxArgs = @("--connection", $selectedContext) }
        }

        # Probe daemon
        $infoArgs = $ctxArgs + @("info")
        $pinfo = New-Object System.Diagnostics.ProcessStartInfo
        $pinfo.FileName = $eng
        $pinfo.Arguments = ($infoArgs -join " ")
        $pinfo.RedirectStandardOutput = $true
        $pinfo.RedirectStandardError = $true
        $pinfo.UseShellExecute = $false

        $proc = [System.Diagnostics.Process]::Start($pinfo)
        $stdout = $proc.StandardOutput.ReadToEnd()
        $stderr = $proc.StandardError.ReadToEnd()
        $proc.WaitForExit()

        if ($proc.ExitCode -eq 0) {
            # Check Linux container mode on Docker
            if ($eng -eq "docker") {
                if ($stdout -match "OSType:\s*windows") {
                    Write-EngineLog -Level "Error" -Message "Docker is currently set to Windows containers. Studio Universal requires Linux container support."
                    exit $script:EXIT_ENGINE
                }
            }

            return @{
                Bin = $eng
                Context = $selectedContext
            }
        } else {
            $combinedErr = ($stderr + " " + $stdout).Trim()
            if ($combinedErr -match "permission denied") {
                Write-EngineLog -Level "Error" -Message "Permission denied accessing $eng daemon socket."
                exit $script:EXIT_ENGINE
            }
            $lastError = "Engine '$eng' daemon is stopped, unreachable, or its machine/VM is not running."
            if ($EnginePref -eq $eng) {
                Write-EngineLog -Level "Error" -Message $lastError
                exit $script:EXIT_ENGINE
            }
        }
    }

    if (-not $foundCli) {
        Write-EngineLog -Level "Error" -Message "Neither Docker nor Podman CLI was found in PATH."
        exit $script:EXIT_PREREQ
    }

    Write-EngineLog -Level "Error" -Message $lastError
    exit $script:EXIT_ENGINE
}

function Get-EngineResources {
    param([string]$TargetDir = "")

    $cpus = [System.Environment]::ProcessorCount
    $ramMb = 2048
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($null -ne $os) {
            $ramMb = [int]($os.TotalVisibleMemorySize / 1024)
        }
    } catch {}

    $diskMb = 5000
    try {
        $drive = Get-PSDrive -PSProvider FileSystem | Select-Object -First 1
        if ($null -ne $drive) {
            $diskMb = [int]($drive.Free / 1048576)
        }
    } catch {}

    return @{
        CPUs = $cpus
        RAMMb = $ramMb
        DiskMb = $diskMb
    }
}

function Get-StudioContainers {
    param(
        [string]$EngineBin,
        [string]$Context = ""
    )

    $ctxArgs = @()
    if (-not [string]::IsNullOrEmpty($Context)) {
        if ($EngineBin -eq "docker") { $ctxArgs = @("--context", $Context) }
        else { $ctxArgs = @("--connection", $Context) }
    }

    $args = $ctxArgs + @("ps", "-a", "--format", '{{.ID}}	{{.Names}}	{{.Label "io.studio.managed"}}	{{.Label "io.studio.installation"}}	{{.Label "io.studio.role"}}	{{.Status}}')
    $output = & $EngineBin @args 2>$null
    $results = @()
    if ($null -ne $output) {
        foreach ($line in $output) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $parts = $line.Split("`t")
            if ($parts.Count -ge 6) {
                $results += @{
                    ID = $parts[0]
                    Name = $parts[1]
                    Managed = ($parts[2] -eq "true")
                    Installation = $parts[3]
                    Role = $parts[4]
                    Status = $parts[5]
                }
            }
        }
    }
    return $results
}

function Get-StudioVolumes {
    param(
        [string]$EngineBin,
        [string]$Context = ""
    )

    $ctxArgs = @()
    if (-not [string]::IsNullOrEmpty($Context)) {
        if ($EngineBin -eq "docker") { $ctxArgs = @("--context", $Context) }
        else { $ctxArgs = @("--connection", $Context) }
    }

    $args = $ctxArgs + @("volume", "ls", "--format", '{{.Name}}	{{.Label "io.studio.managed"}}	{{.Label "io.studio.installation"}}	{{.Label "io.studio.role"}}')
    $output = & $EngineBin @args 2>$null
    $results = @()
    if ($null -ne $output) {
        foreach ($line in $output) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $parts = $line.Split("`t")
            if ($parts.Count -ge 4) {
                $results += @{
                    Name = $parts[0]
                    Managed = ($parts[1] -eq "true")
                    Installation = $parts[2]
                    Role = $parts[3]
                }
            }
        }
    }
    return $results
}

function Get-StudioNetworks {
    param(
        [string]$EngineBin,
        [string]$Context = ""
    )

    $ctxArgs = @()
    if (-not [string]::IsNullOrEmpty($Context)) {
        if ($EngineBin -eq "docker") { $ctxArgs = @("--context", $Context) }
        else { $ctxArgs = @("--connection", $Context) }
    }

    $args = $ctxArgs + @("network", "ls", "--format", '{{.ID}}	{{.Name}}	{{.Label "io.studio.managed"}}	{{.Label "io.studio.installation"}}')
    $output = & $EngineBin @args 2>$null
    $results = @()
    if ($null -ne $output) {
        foreach ($line in $output) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $parts = $line.Split("`t")
            if ($parts.Count -ge 4) {
                $results += @{
                    ID = $parts[0]
                    Name = $parts[1]
                    Managed = ($parts[2] -eq "true")
                    Installation = $parts[3]
                }
            }
        }
    }
    return $results
}

function Get-StudioImages {
    param(
        [string]$EngineBin,
        [string]$Context = ""
    )

    $ctxArgs = @()
    if (-not [string]::IsNullOrEmpty($Context)) {
        if ($EngineBin -eq "docker") { $ctxArgs = @("--context", $Context) }
        else { $ctxArgs = @("--connection", $Context) }
    }

    $args = $ctxArgs + @("images", "--format", '{{.ID}}	{{.Repository}}:{{.Tag}}	{{.Digest}}')
    $output = & $EngineBin @args 2>$null
    $results = @()
    if ($null -ne $output) {
        foreach ($line in $output) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $parts = $line.Split("`t")
            if ($parts.Count -ge 3) {
                $results += @{
                    ID = $parts[0]
                    Tag = $parts[1]
                    Digest = $parts[2]
                }
            }
        }
    }
    return $results
}
