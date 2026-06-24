# Sync vendor logos/cabinet images from NAS (M:) into MEDIA_ROOT_HOST for Docker bind mount.
# Docker Desktop on Windows cannot read M:/ or UNC mounts — they appear empty in containers.
#
# Default dest (outside portfolio_site repo):
#   ../portfolio_media/tableau-images
#
# Override dest:
#   $env:MEDIA_ROOT_HOST = "D:\dgs\tableau-images"
#   .\scripts\sync_tableau_images.ps1
#
# Optional: schedule via Task Scheduler after NAS image updates.
# On hosts with restricted execution policy, use scripts\sync_tableau_images.cmd instead.

$ErrorActionPreference = "Stop"

$Source = "M:\Paul Collins\tableau images"
$RepoRoot = Split-Path $PSScriptRoot -Parent

if ($env:MEDIA_ROOT_HOST) {
    $Dest = $env:MEDIA_ROOT_HOST
} else {
    $Dest = Join-Path (Split-Path $RepoRoot -Parent) "portfolio_media\tableau-images"
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

if (-not (Test-Path $Source)) {
    Write-Error "NAS source not found: $Source (is M: mapped to \\192.168.1.99\DGS_Analytics?)"
}

Write-Host "Syncing $Source -> $Dest"
robocopy $Source $Dest /E /FFT /Z /W:2 /R:2
$code = $LASTEXITCODE
if ($code -ge 8) {
    Write-Error "robocopy failed with exit code $code"
}
Write-Host "Done. Restart backend if running:"
Write-Host "  docker compose --env-file backend_live/.env up -d"
