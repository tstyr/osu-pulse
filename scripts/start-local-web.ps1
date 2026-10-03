$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$workDirectory = Join-Path $projectRoot "work"
$logPath = Join-Path $workDirectory "web-ui.log"
$buildId = Join-Path $projectRoot ".next\BUILD_ID"
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

function Write-WebLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" -Encoding UTF8
}

function Test-PulseWebProcess {
    # Another local application may legitimately use [::1]:3000. osu! Pulse
    # binds explicitly to IPv4, so only inspect its actual listener address.
    $listeners = @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return $false }
    foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -match [regex]::Escape($projectRoot) -and $process.CommandLine -match "next.*start") {
            return $true
        }
    }
    throw "Port 3000 is already in use by a process that is not the osu! Pulse Web UI."
}

if (Test-PulseWebProcess) {
    Write-WebLog "Web UI is already listening on 127.0.0.1:3000."
    exit 0
}

$buildMissing = -not (Test-Path -LiteralPath $buildId -PathType Leaf)
$buildOutdated = $false
if (-not $buildMissing) {
    $buildTime = (Get-Item -LiteralPath $buildId).LastWriteTimeUtc
    $watchedFiles = @(
        Get-ChildItem -LiteralPath (Join-Path $projectRoot "src") -Recurse -File -ErrorAction SilentlyContinue
        Get-Item -LiteralPath (Join-Path $projectRoot "next.config.ts") -ErrorAction SilentlyContinue
        Get-Item -LiteralPath (Join-Path $projectRoot "package.json") -ErrorAction SilentlyContinue
        Get-Item -LiteralPath (Join-Path $projectRoot "package-lock.json") -ErrorAction SilentlyContinue
    )
    $buildOutdated = [bool]($watchedFiles | Where-Object { $_.LastWriteTimeUtc -gt $buildTime } | Select-Object -First 1)
}

if ($buildMissing -or $buildOutdated) {
    Write-WebLog "Production build is missing or outdated; running npm run build."
    Push-Location $projectRoot
    try {
        & $npm run build 2>&1 | ForEach-Object {
            $line = [string]$_
            Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
            Write-Output $line
        }
        if ($LASTEXITCODE -ne 0) { throw "Next.js production build failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

Write-WebLog "Starting local Web UI on 127.0.0.1:3000."
Push-Location $projectRoot
try {
    & $npm run start:local 2>&1 | ForEach-Object {
        $line = [string]$_
        Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
        Write-Output $line
    }
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
