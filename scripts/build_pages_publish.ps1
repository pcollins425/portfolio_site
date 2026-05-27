# Merge root **coming soon** + production Vite app under **/dashboardtestv1/** for Cloudflare Pages.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "frontend")
npm install
if (-not $env:VITE_API_BASE_URL) { $env:VITE_API_BASE_URL = "https://api.collinsmediallc.com" }
npm run build
Set-Location $Root
$pub = Join-Path $Root "pages_publish"
if (Test-Path $pub) { Remove-Item -Recurse -Force $pub }
New-Item -ItemType Directory -Path (Join-Path $pub "dashboardtestv1") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pub "scannertestv1") | Out-Null
Copy-Item (Join-Path $Root "index.html") (Join-Path $pub "index.html")
Copy-Item -Path (Join-Path $Root "frontend\dist\*") -Destination (Join-Path $pub "dashboardtestv1") -Recurse -Force
Copy-Item (Join-Path $Root "scannertestv1\index.html") (Join-Path $pub "scannertestv1\index.html")
Write-Host "OK: $pub  (coming soon + /dashboardtestv1 SPA + /scannertestv1 scanner demo)"
