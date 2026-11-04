# Merge Collins Media root shop + production Vite app under **/dashboardtestv1/** for Cloudflare Workers assets.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "frontend")
npm install
if (-not $env:VITE_API_BASE_URL) { $env:VITE_API_BASE_URL = "https://api.collinsmediallc.com" }
npm run build
npm run build:dgsapp
Set-Location $Root
$pub = Join-Path $Root "pages_publish"
if (Test-Path $pub) { Remove-Item -Recurse -Force $pub }
New-Item -ItemType Directory -Path (Join-Path $pub "dashboardtestv1") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pub "scannertestv1") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pub "emaintdemov1") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pub "warehouseinventoryv1") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pub "dgsappv1") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pub "marketing") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pub "apps") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pub "functions") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pub "practice") | Out-Null
Copy-Item (Join-Path $Root "index.html") (Join-Path $pub "index.html")
Copy-Item (Join-Path $Root "shop.html") (Join-Path $pub "shop.html")
Copy-Item (Join-Path $Root "about.html") (Join-Path $pub "about.html")
Copy-Item -Path (Join-Path $Root "marketing\*") -Destination (Join-Path $pub "marketing") -Recurse -Force
Copy-Item -Path (Join-Path $Root "apps\*") -Destination (Join-Path $pub "apps") -Recurse -Force
Copy-Item -Path (Join-Path $Root "functions\*") -Destination (Join-Path $pub "functions") -Recurse -Force
Copy-Item -Path (Join-Path $Root "practice\*") -Destination (Join-Path $pub "practice") -Recurse -Force
Copy-Item -Path (Join-Path $Root "frontend\dist\*") -Destination (Join-Path $pub "dashboardtestv1") -Recurse -Force
Copy-Item (Join-Path $Root "scannertestv1\index.html") (Join-Path $pub "scannertestv1\index.html")
Copy-Item -Path (Join-Path $Root "emaintdemov1\*") -Destination (Join-Path $pub "emaintdemov1") -Recurse -Force
Copy-Item -Path (Join-Path $Root "warehouseinventoryv1\*") -Destination (Join-Path $pub "warehouseinventoryv1") -Recurse -Force
Copy-Item -Path (Join-Path $Root "dgsappv1\*") -Destination (Join-Path $pub "dgsappv1") -Recurse -Force
Write-Host "OK: $pub  (Collins Media shop + /dashboardtestv1 + /dgsappv1 + legacy demos)"
