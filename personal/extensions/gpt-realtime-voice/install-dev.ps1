[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$source = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $source '..\..\..')).Path
$runtimePluginRoot = Join-Path $repoRoot '.local\home\plugins'
$target = Join-Path $runtimePluginRoot 'gpt-realtime-voice'
$desktopPluginRoot = Join-Path $repoRoot '.local\home\desktop-plugins'
$desktopTarget = Join-Path $desktopPluginRoot 'gpt-realtime-voice'
$desktopSource = Join-Path $source 'desktop'
$personalLauncher = Join-Path $repoRoot 'scripts\hermes-personal.ps1'

New-Item -ItemType Directory -Force -Path $runtimePluginRoot | Out-Null
New-Item -ItemType Directory -Force -Path $desktopPluginRoot | Out-Null

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

if (Test-Path -LiteralPath $desktopTarget) {
    $desktopItem = Get-Item -LiteralPath $desktopTarget -Force
    $resolvedDesktopTarget = if ($desktopItem.Target) { (Resolve-Path $desktopItem.Target).Path } else { '' }
    if ($resolvedDesktopTarget -ne (Resolve-Path $desktopSource).Path) {
        throw "Desktop plugin target already exists and does not point to this source: $desktopTarget"
    }
}
else {
    New-Item -ItemType Junction -Path $desktopTarget -Target $desktopSource | Out-Null
}

& $personalLauncher plugins enable gpt-realtime-voice
if ($LASTEXITCODE -ne 0) {
    throw 'Hermes could not enable gpt-realtime-voice.'
}

Write-Output "Development plugin: $target -> $source"
Write-Output "Desktop plugin: $desktopTarget -> $desktopSource"
Write-Output 'Restart Hermes Desktop, open an existing chat, and press the primary voice button.'
