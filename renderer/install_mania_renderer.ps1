$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$rendererRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $rendererRoot
$sourcePath = Join-Path $rendererRoot "local\osu-mania-renderer"
$hudPatch = Join-Path $rendererRoot "mania-hud.patch"
$venvPath = Join-Path $rendererRoot ".venv-mania"
$pythonPath = Join-Path $venvPath "Scripts\python.exe"
$commit = "361ed13bb618b9986b72ee7b5d313a02c59fa1aa"
$repository = "https://github.com/R3dWolfie/osu-mania-renderer.git"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required to install the osu!mania renderer."
}

if (-not (Test-Path -LiteralPath (Join-Path $sourcePath ".git") -PathType Container)) {
    if (Test-Path -LiteralPath $sourcePath) {
        throw "The mania renderer target exists but is not the managed Git checkout: $sourcePath"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $sourcePath) -Force | Out-Null
    & git clone --filter=blob:none --no-tags --single-branch --branch mania-v3 $repository $sourcePath
    if ($LASTEXITCODE -ne 0) { throw "Could not clone the osu!mania renderer." }
    & git -C $sourcePath checkout $commit
    if ($LASTEXITCODE -ne 0) { throw "Could not select the pinned osu!mania renderer revision." }
}

$currentCommit = (& git -C $sourcePath rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $currentCommit -ne $commit) {
    throw "Unexpected osu!mania renderer revision. Expected $commit but found $currentCommit."
}

if (Test-Path -LiteralPath $hudPatch -PathType Leaf) {
    & git -C $sourcePath apply --check $hudPatch 2>$null
    if ($LASTEXITCODE -eq 0) {
        & git -C $sourcePath apply $hudPatch
        if ($LASTEXITCODE -ne 0) { throw "Could not apply the osu! Pulse mania HUD patch." }
    } else {
        & git -C $sourcePath apply --reverse --check $hudPatch 2>$null
        if ($LASTEXITCODE -ne 0) { throw "The osu!mania source does not match the managed HUD patch." }
    }
}

if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    & py -3.13 -m venv $venvPath
    if ($LASTEXITCODE -ne 0) { & py -3.12 -m venv $venvPath }
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 or newer is required for the osu!mania renderer." }
}

& $pythonPath -m pip install --disable-pip-version-check -r (Join-Path $rendererRoot "mania-requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Could not install osu!mania renderer dependencies." }

& $pythonPath (Join-Path $rendererRoot "mania_cli.py") --source-path $sourcePath --probe
if ($LASTEXITCODE -ne 0) { throw "The osu!mania renderer GPU probe failed." }

Write-Host "[OK] osu!mania renderer is installed at pinned revision $commit."
