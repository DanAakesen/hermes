[CmdletBinding()]
param(
    [switch]$InstallDependencies,
    [switch]$ForceConfig
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeHome = Join-Path $repoRoot '.local\home'
$venvRoot = Join-Path $env:USERPROFILE '.hermes\venvs\repo-hermes'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$configTemplate = Join-Path $repoRoot 'personal\config.yaml'
$runtimeConfig = Join-Path $runtimeHome 'config.yaml'
$runtimeEnv = Join-Path $runtimeHome '.env'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw 'uv is required. Install uv, then run this script again.'
}

foreach ($directoryName in @('cron', 'logs', 'memories', 'sessions', 'skills', 'plugins', 'pairing')) {
    $directoryPath = Join-Path $runtimeHome $directoryName
    New-Item -ItemType Directory -Force -Path $directoryPath | Out-Null
}

if ($ForceConfig -or -not (Test-Path -LiteralPath $runtimeConfig)) {
    Copy-Item -LiteralPath $configTemplate -Destination $runtimeConfig -Force
}

if (-not (Test-Path -LiteralPath $runtimeEnv)) {
    New-Item -ItemType File -Path $runtimeEnv | Out-Null
}

if ($InstallDependencies) {
    uv venv $venvRoot --python 3.11
    uv pip install --python $venvPython -e '.[all,dev]'
}

Write-Output "Repository: $repoRoot"
Write-Output "HERMES_HOME: $runtimeHome"
Write-Output "Virtual environment: $venvRoot"
Write-Output 'Next: add only credentials to .local/home/.env, then run scripts/hermes-personal.ps1 setup.'
