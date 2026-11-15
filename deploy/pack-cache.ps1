# Makes deploy\out\arcnave-cache.tar: this PC's whole ARCNAVE cache (every field opened here: SPHEREx cutouts, archive
# answers, sky tiles, NEOSSat pictures, the pinned start-screen list), to load into the server once (deploy/load-cache.sh).
# Every field opened on this PC then opens from the server's disk at once, for every visitor.
# Run in PowerShell from the repo folder:   powershell -ExecutionPolicy Bypass -File deploy\pack-cache.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $root 'cache'
if (-not (Test-Path $cache)) { throw "No cache folder at $cache (open some fields first)" }
$outDir = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir 'arcnave-cache.tar'
# plain tar: the cutouts are gzipped already and the sky tiles are JPEG/PNG, so compressing again gains almost nothing
$parts = @('cutouts', 'api', 'hips', 'neossat', 'pinned.json') | Where-Object { Test-Path (Join-Path $cache $_) }
Push-Location $cache
try {
  & "$env:SystemRoot\System32\tar.exe" -cf $out @parts
  if ($LASTEXITCODE -ne 0) { throw "tar failed ($LASTEXITCODE)" }
} finally { Pop-Location }
$gb = [math]::Round((Get-Item $out).Length / 1GB, 2)
Write-Host "Made $out ($gb GB: $($parts -join ', ')). Next: copy it to the server and run deploy/load-cache.sh (DEPLOY-CLOUDFLARE.md)."
