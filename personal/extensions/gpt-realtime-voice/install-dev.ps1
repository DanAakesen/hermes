[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$source = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $source '..\..\..')).Path
$runtimePluginRoot = Join-Path $repoRoot '.local\home\plugins'
$target = Join-Path $runtimePluginRoot 'gpt-realtime-voice'
$personalLauncher = Join-Path $repoRoot 'scripts\hermes-personal.ps1'

New-Item -ItemType Directory -Force -Path $runtimePluginRoot | Out-Null

if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target -Force
    $resolvedTarget = if ($item.Target) { (Resolve-Path $item.Target).Path } else { '' }
    if ($resolvedTarget -ne (Resolve-Path $source).Path) {
        throw "Plugin target already exists and does not point to this source: $target"
    }
}
else {
    New-Item -ItemType Junction -Path $target -Target $source | Out-Null
}

& $personalLauncher plugins enable gpt-realtime-voice
if ($LASTEXITCODE -ne 0) {
    throw 'Hermes could not enable gpt-realtime-voice.'
}

Write-Output "Development plugin: $target -> $source"
Write-Output 'Start it with: .\scripts\hermes-personal.ps1 voice serve --open'
