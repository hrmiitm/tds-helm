# ==============================================================================
# uninstall.ps1 — Universal Clean Uninstaller Shortcut for Windows
# Safely stops containers, removes volumes, and cleans up host state
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$PurgeImages,
    [switch]$DryRun
)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$params = @()
if ($PurgeImages) { $params += "-PurgeImages" }
if ($DryRun) { $params += "-DryRun" }
& "$ScriptDir\clean-uninstall.ps1" -Yes @params

