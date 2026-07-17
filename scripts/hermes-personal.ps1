[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$HermesArguments
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$env:HERMES_HOME = Join-Path $repoRoot '.local\home'
$venvRoot = Join-Path $env:USERPROFILE '.hermes\venvs\repo-hermes'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$hermesExecutable = Join-Path $venvRoot 'Scripts\hermes.exe'

if (-not (Test-Path -LiteralPath $hermesExecutable)) {
    throw 'Hermes is not installed for this checkout. Run scripts/personal-bootstrap.ps1 -InstallDependencies first.'
}

if ($HermesArguments -contains 'desktop') {
    # The Desktop runtime normally looks for .venv or venv inside the source
    # checkout. This personal installation intentionally keeps its venv outside
    # the checkout, so pin both the source root and editable Python explicitly.
    $env:HERMES_DESKTOP_HERMES_ROOT = $repoRoot
    $env:HERMES_DESKTOP_PYTHON = $venvPython
}

& $hermesExecutable @HermesArguments
exit $LASTEXITCODE
