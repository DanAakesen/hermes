[CmdletBinding()]
param(
    [switch]$SkipDependencySync
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $env:USERPROFILE '.hermes\venvs\repo-hermes\Scripts\python.exe'

Push-Location $repoRoot
try {
    $workingTreeChanges = git status --porcelain
    if ($workingTreeChanges) {
        throw 'Working tree has uncommitted changes. Commit or stash them before updating.'
    }

    git fetch upstream main --quiet
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not fetch upstream/main.'
    }

    git rebase upstream/main
    if ($LASTEXITCODE -ne 0) {
        throw 'Rebase stopped for a conflict. Resolve it, run git rebase --continue, then rerun this script.'
    }

    git push origin HEAD:personal/main
    if ($LASTEXITCODE -ne 0) {
        throw 'Updated locally but could not push personal/main to GitHub.'
    }

    if (-not $SkipDependencySync) {
        if (-not (Test-Path -LiteralPath $venvPython)) {
            throw 'The Hermes virtual environment is missing. Run scripts/personal-bootstrap.ps1 -InstallDependencies first.'
        }

        uv pip install --python $venvPython -e '.[all,dev]'
    }
}
finally {
    Pop-Location
}

Write-Output 'Hermes source and dependencies are current. Restart the gateway when convenient.'
