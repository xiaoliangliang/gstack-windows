$ErrorActionPreference = 'Stop'

function Get-CommandPath {
  param([string]$Name)

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Get-GitOutput {
  param(
    [string[]]$GitArgs,
    [string]$WorkingDirectory = (Get-Location).Path
  )

  try {
    $result = & git -C $WorkingDirectory @GitArgs 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return (($result | Out-String).Trim())
  } catch {
    return $null
  }
}

function Get-ValueOrDefault {
  param(
    $Value,
    [string]$Default
  )

  if ($null -ne $Value -and "$Value".Trim() -ne '') {
    return $Value
  }

  return $Default
}

function Write-Check {
  param(
    [string]$Label,
    [bool]$Ok,
    [string]$Details
  )

  $status = if ($Ok) { '[ OK ]' } else { '[FAIL]' }
  Write-Host "$status $Label"
  if ($Details) {
    Write-Host "       $Details"
  }
}

$codexInstall = Join-Path $env:USERPROFILE '.codex\skills\gstack'
$claudeFallback = Join-Path $env:USERPROFILE '.claude\skills\gstack'
$activeInstall = $null

if (Test-Path $codexInstall) {
  $activeInstall = $codexInstall
} elseif (Test-Path $claudeFallback) {
  $activeInstall = $claudeFallback
}

$gitPath = Get-CommandPath 'git'
$bunPath = Get-CommandPath 'bun'
$nodePath = Get-CommandPath 'node'
$npmPath = Get-CommandPath 'npm'
$bashPath = Get-CommandPath 'bash'

$chromeCandidates = @(
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

$browseCandidates = @()
if ($activeInstall) {
  $browseCandidates += (Join-Path $activeInstall 'browse\dist\browse')
  $browseCandidates += (Join-Path $activeInstall 'browse\dist\browse.cmd')
  $browseCandidates += (Join-Path $activeInstall 'browse\dist\browse.exe')
}
$browsePath = $browseCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$installRemote = $null
$installIsFork = $false

if ($activeInstall -and (Test-Path (Join-Path $activeInstall '.git'))) {
  $installRemote = Get-GitOutput -WorkingDirectory $activeInstall -GitArgs @('remote', 'get-url', 'origin')
  $installIsFork = [bool]($installRemote -match 'xiaoliangliang/gstack-windows')
}

$currentProjectRoot = Get-GitOutput -GitArgs @('rev-parse', '--show-toplevel')
$projectProfileDir = $null
$projectLaunchConfig = $null
$projectHasProfile = $false
$projectHasLaunchConfig = $false
$recommendedInstall = if ($activeInstall) { $activeInstall } else { $codexInstall }

if ($currentProjectRoot) {
  $projectProfileDir = Join-Path $currentProjectRoot '.gstack\chrome-profile'
  $projectLaunchConfig = Join-Path $currentProjectRoot '.gstack\browse-launch.json'
  $projectHasProfile = Test-Path $projectProfileDir
  $projectHasLaunchConfig = Test-Path $projectLaunchConfig
}

Write-Host "gstack-windows doctor"
Write-Host ""

Write-Check 'Git' ([bool]$gitPath) (Get-ValueOrDefault $gitPath 'Install Git first.')
Write-Check 'Bun' ([bool]$bunPath) (Get-ValueOrDefault $bunPath 'Install Bun first: https://bun.sh/')
Write-Check 'Node.js' ([bool]$nodePath) (Get-ValueOrDefault $nodePath 'Node.js is required for the Windows runtime shims.')
Write-Check 'npm' ([bool]$npmPath) (Get-ValueOrDefault $npmPath 'npm is required because setup.ps1 installs tsx when needed.')
Write-Check 'Git Bash' ([bool]$bashPath) (Get-ValueOrDefault $bashPath 'Recommended for running Bash snippets from SKILL.md.')
Write-Check 'Chrome / Edge' ([bool]$chromePath) (Get-ValueOrDefault $chromePath 'Install Chrome or Edge for headed login-session flows.')
Write-Check 'Active gstack install' ([bool]$activeInstall) (Get-ValueOrDefault $activeInstall 'Expected at ~/.codex/skills/gstack')
Write-Check 'browse runtime' ([bool]$browsePath) (Get-ValueOrDefault $browsePath 'Run setup.ps1 in the active install.')
if ($activeInstall) {
  Write-Check 'Install remote' ([bool]$installIsFork) (Get-ValueOrDefault $installRemote 'Could not read git remote. Expected xiaoliangliang/gstack-windows.')
}

if ($activeInstall) {
  $versionFile = Join-Path $activeInstall 'VERSION'
  if (Test-Path $versionFile) {
    $version = (Get-Content -Raw $versionFile).Trim()
    Write-Host ""
    Write-Host "Version: $version"
  }
}

if ($currentProjectRoot) {
  Write-Host ""
  Write-Host "Current project:"
  Write-Host "  Repo: $currentProjectRoot"
  Write-Host "  Saved login profile: $(if ($projectHasProfile) { 'yes' } else { 'no' })"
  if ($projectProfileDir) {
    Write-Host "  Profile path: $projectProfileDir"
  }
  Write-Host "  Launch config: $(if ($projectHasLaunchConfig) { 'yes' } else { 'no' })"
}

Write-Host ""
Write-Host "Recommended next commands:"
if ($activeInstall -and -not $installIsFork -and $currentProjectRoot -and (Test-Path (Join-Path $currentProjectRoot 'install-codex-global.ps1'))) {
  Write-Host "  powershell -ExecutionPolicy Bypass -File `"$currentProjectRoot\install-codex-global.ps1`""
}
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$recommendedInstall\setup.ps1`""
if ($currentProjectRoot -and $projectHasProfile) {
  Write-Host "  browse login-session status"
  Write-Host "  browse login-session headed https://www.douyin.com/"
  Write-Host "  browse login-session headless"
} else {
  Write-Host "  browse login-session headed https://www.douyin.com/"
  Write-Host "  browse login-session headless"
}
