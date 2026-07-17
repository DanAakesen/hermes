[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$HermesArguments
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$env:HERMES_HOME = Join-Path $repoRoot '.local\home'
$hermesExecutable = Join-Path $env:USERPROFILE '.hermes\venvs\repo-hermes\Scripts\hermes.exe'

if (-not (Test-Path -LiteralPath $hermesExecutable)) {
    throw 'Hermes is not installed for this checkout. Run scripts/personal-bootstrap.ps1 -InstallDependencies first.'
}

& $hermesExecutable @HermesArguments
exit $LASTEXITCODE
