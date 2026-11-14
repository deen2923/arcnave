# Builds and publishes ARCNAVE on Cloudflare (DEPLOY-CLOUDFLARE-ONLY.md). Run in PowerShell from the repo folder:
#   powershell -ExecutionPolicy Bypass -File deploy\cloudflare\deploy.ps1 https://arcnave.<your-subdomain>.workers.dev
# The first time, "wrangler login" opens the browser to allow it; later runs reuse that login.
param([Parameter(Mandatory = $true)][string]$Site)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nodeDir = Join-Path (Split-Path -Parent $root) 'node\node-v24.20.0-win-x64'
if (Test-Path (Join-Path $nodeDir 'node.exe')) { $env:Path = "$nodeDir;$env:Path" }
Set-Location $root
Write-Host "Building deploy\out\cf for $Site (2-3 minutes)..."
& node deploy\cloudflare\build.mjs $Site
if ($LASTEXITCODE -ne 0) { throw 'build failed' }
& npx --yes wrangler@4 whoami | Out-Null
if ($LASTEXITCODE -ne 0) { & npx --yes wrangler@4 login }
Write-Host 'Uploading (the first time about 2.5 GB: 20-60 minutes; later only changed files)...'
& npx --yes wrangler@4 deploy --config deploy\cloudflare\wrangler.toml
if ($LASTEXITCODE -ne 0) { throw 'deploy failed' }
Write-Host "Done: $Site"
