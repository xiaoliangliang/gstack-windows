$ErrorActionPreference = 'Stop'

$gstackDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$browseDist = Join-Path $gstackDir 'browse/dist'
$bunCandidates = @(
  (Join-Path $env:USERPROFILE '.bun/bin/bun.exe'),
  (Join-Path $env:USERPROFILE '.bun\bin\bun.exe')
)

$bun = $null
foreach ($candidate in $bunCandidates) {
  if ($candidate -and (Test-Path $candidate)) {
    $bun = $candidate
    break
  }
}
if (-not $bun) {
  $bunCmd = Get-Command bun.exe -ErrorAction SilentlyContinue
  if ($bunCmd) {
    $bun = $bunCmd.Source
  }
}
if (-not $bun) {
  throw "bun.exe not found. Install Bun first, then rerun setup.ps1."
}

function Convert-ToGitBashPath {
  param([string]$InputPath)

  $resolved = (Resolve-Path -LiteralPath $InputPath).Path
  $normalized = $resolved -replace '\\', '/'
  if ($normalized -match '^([A-Za-z]):/(.*)$') {
    return "/$($matches[1].ToLower())/$($matches[2])"
  }
  return $normalized
}

Push-Location $gstackDir
try {
  & $bun install

  if (-not (Test-Path (Join-Path $gstackDir 'node_modules/tsx'))) {
    npm install tsx --no-save
  }

  & $bun run gen:skill-docs
  & $bun x playwright install chromium

  New-Item -ItemType Directory -Force -Path $browseDist | Out-Null

  $browseShim = @'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/../.." || exit 1
node --experimental-sqlite --import tsx "./browse/src/cli.ts" "$@"
'@
  $findBrowseShim = @'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/../.." || exit 1
node --experimental-sqlite --import tsx "./browse/src/find-browse.ts" "$@"
'@
  $browseCmd = @'
@echo off
set SCRIPT_DIR=%~dp0
pushd "%SCRIPT_DIR%..\.." >nul
node --experimental-sqlite --import tsx "%SCRIPT_DIR%..\src\cli.ts" %*
set EXIT_CODE=%ERRORLEVEL%
popd >nul
exit /b %EXIT_CODE%
'@
  $findBrowseCmd = @'
@echo off
set SCRIPT_DIR=%~dp0
pushd "%SCRIPT_DIR%..\.." >nul
node --experimental-sqlite --import tsx "%SCRIPT_DIR%..\src\find-browse.ts" %*
set EXIT_CODE=%ERRORLEVEL%
popd >nul
exit /b %EXIT_CODE%
'@

  Set-Content -Path (Join-Path $browseDist 'browse') -Value $browseShim -NoNewline
  Set-Content -Path (Join-Path $browseDist 'find-browse') -Value $findBrowseShim -NoNewline
  Set-Content -Path (Join-Path $browseDist 'browse.cmd') -Value $browseCmd -NoNewline
  Set-Content -Path (Join-Path $browseDist 'find-browse.cmd') -Value $findBrowseCmd -NoNewline

  if (Test-Path 'C:/Program Files/Git/bin/bash.exe') {
    $browseShimPath = Convert-ToGitBashPath (Join-Path $browseDist 'browse')
    $findBrowseShimPath = Convert-ToGitBashPath (Join-Path $browseDist 'find-browse')
    & 'C:/Program Files/Git/bin/bash.exe' -lc "chmod +x '$browseShimPath' '$findBrowseShimPath'" | Out-Null
  }

  try {
    $gitSha = (git -C $gstackDir rev-parse HEAD).Trim()
    if ($gitSha) {
      Set-Content -Path (Join-Path $browseDist '.version') -Value $gitSha -NoNewline
    }
  } catch {
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE '.gstack/projects') | Out-Null

  Write-Output "gstack ready."
  Write-Output "  browse: $(Join-Path $browseDist 'browse')"
  Write-Output "  runtime: node --import tsx"
} finally {
  Pop-Location
}
