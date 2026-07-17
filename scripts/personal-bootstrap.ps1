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

# Make the packaged Desktop app use this checkout even when it is launched
# directly from a pinned Windows shortcut. The virtual environment remains
# outside the source tree by design.
[Environment]::SetEnvironmentVariable('HERMES_HOME', $runtimeHome, 'User')
[Environment]::SetEnvironmentVariable('HERMES_DESKTOP_HERMES_ROOT', $repoRoot, 'User')
[Environment]::SetEnvironmentVariable('HERMES_DESKTOP_PYTHON', $venvPython, 'User')

# This fork may fetch upstream releases but must never push to the upstream
# repository. The tracked hook enforces the same rule before every push.
git config --local core.hooksPath .githooks
git config --local remote.pushDefault origin
if (git remote get-url upstream 2>$null) {
    git config --local remote.upstream.pushurl DISABLED
}

$venvScripts = Join-Path $venvRoot 'Scripts'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @($userPath -split ';' | Where-Object { $_ })
if (-not ($pathEntries | Where-Object { $_.TrimEnd('\\') -ieq $venvScripts.TrimEnd('\\') })) {
    [Environment]::SetEnvironmentVariable('Path', "$venvScripts;$userPath", 'User')
}

Write-Output "Repository: $repoRoot"
Write-Output "HERMES_HOME: $runtimeHome"
Write-Output "Virtual environment: $venvRoot"
Write-Output 'Desktop launch variables are configured for this Windows user.'
Write-Output 'The `hermes` command is available in new terminals.'
Write-Output 'Next: add only credentials to .local/home/.env, then run scripts/hermes-personal.ps1 setup.'
