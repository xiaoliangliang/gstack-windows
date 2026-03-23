[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE '.codex\skills\gstack'),
  [string]$RepoUrl = 'https://github.com/xiaoliangliang/gstack-windows.git',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Require-Command {
  param([string]$Name)

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    switch ($Name) {
      'git' { throw "git is required but was not found in PATH. Install Git for Windows first." }
      'node' { throw "node is required but was not found in PATH. Install Node.js first." }
      'npm' { throw "npm is required but was not found in PATH. Install Node.js first." }
      'bun' { throw "bun is required but was not found in PATH. Install Bun first: https://bun.sh/" }
      default { throw "$Name is required but was not found in PATH." }
    }
  }
}

Require-Command git
Require-Command node
Require-Command npm
Require-Command bun

function Get-DefaultBranch {
  param([string]$RepoDir)

  $ref = git -C $RepoDir symbolic-ref refs/remotes/origin/HEAD 2>$null
  if ($LASTEXITCODE -eq 0 -and $ref) {
    return [System.IO.Path]::GetFileName(($ref | Out-String).Trim())
  }

  return 'main'
}

function Get-OriginUrl {
  param([string]$RepoDir)

  $remote = git -C $RepoDir remote get-url origin 2>$null
  if ($LASTEXITCODE -eq 0 -and $remote) {
    return ($remote | Out-String).Trim()
  }

  return $null
}

function Test-IsForkRemote {
  param([string]$RemoteUrl)

  return [bool]($RemoteUrl -match 'xiaoliangliang/gstack-windows(?:\.git)?$')
}

Write-Host "Preflight checks passed."

$parentDir = Split-Path -Parent $InstallDir
if (-not (Test-Path $parentDir)) {
  New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
}

if (Test-Path $InstallDir) {
  if (Test-Path (Join-Path $InstallDir '.git')) {
    $dirty = git -C $InstallDir status --porcelain
    if (($dirty | Out-String).Trim()) {
      throw "Existing install has uncommitted changes at $InstallDir`nCommit or discard those changes before running the installer again."
    }

    $originUrl = Get-OriginUrl $InstallDir
    if (-not $originUrl) {
      Write-Host "No origin remote found. Setting origin to $RepoUrl ..."
      git -C $InstallDir remote add origin $RepoUrl
    } elseif (-not (Test-IsForkRemote $originUrl)) {
      Write-Host "Existing install points to $originUrl"
      Write-Host "Switching origin to $RepoUrl ..."
      git -C $InstallDir remote set-url origin $RepoUrl
    }

    $defaultBranch = Get-DefaultBranch $InstallDir
    Write-Host "Updating existing install at $InstallDir ..."
    git -C $InstallDir fetch origin
    git -C $InstallDir checkout $defaultBranch
    git -C $InstallDir pull --ff-only origin $defaultBranch
  } elseif ($Force) {
    Write-Host "Replacing existing non-git directory at $InstallDir ..."
    Remove-Item -Recurse -Force $InstallDir
    git clone $RepoUrl $InstallDir
  } else {
    throw "Install directory already exists and is not a git checkout: $InstallDir`nMove it away, delete it, or rerun with -Force."
  }
} else {
  Write-Host "Cloning gstack-windows into $InstallDir ..."
  git clone $RepoUrl $InstallDir
}

$setupScript = Join-Path $InstallDir 'setup.ps1'
Write-Host "Running setup.ps1 ..."
powershell -ExecutionPolicy Bypass -File $setupScript

$doctorScript = Join-Path $InstallDir 'doctor.ps1'
if (Test-Path $doctorScript) {
  Write-Host ""
  Write-Host "Running doctor.ps1 ..."
  powershell -ExecutionPolicy Bypass -File $doctorScript
}

Write-Host ""
Write-Host "gstack-windows is installed."
Write-Host "Global path: $InstallDir"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Run the doctor: powershell -ExecutionPolicy Bypass -File `"$InstallDir\doctor.ps1`""
Write-Host "  2. Start a persistent login session:"
Write-Host "     browse login-session headed https://www.douyin.com/"
Write-Host "  3. After manual login, switch to headless reuse:"
Write-Host "     browse login-session headless"
Write-Host "  4. Read the docs:"
Write-Host "     $InstallDir\docs\QUICKSTART-WINDOWS.md"
