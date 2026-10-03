param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("web", "bot", "renderer", "lavalink")]
    [string]$Service,
    [int]$CurrentProcessId = 0
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$workDirectory = Join-Path $projectRoot "work"
$logPath = Join-Path $workDirectory "service-restarts.log"
New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

function Write-RestartLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Service] $Message" -Encoding UTF8
}

function Stop-VerifiedProcess([int]$ProcessId, [string]$ExpectedPattern) {
    if ($ProcessId -le 0) { return }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) { return }
    if ($process.CommandLine -notmatch $ExpectedPattern) {
        throw "Refused to stop PID $ProcessId because its command line does not match $ExpectedPattern"
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    Write-RestartLog "Stopped PID $ProcessId."
}

try {
    $launcher = switch ($Service) {
        "web" { Join-Path $projectRoot "start_web_ui.bat" }
        "bot" { Join-Path $projectRoot "bot\start_bot.bat" }
        "renderer" { Join-Path $projectRoot "renderer\start_renderer.bat" }
        "lavalink" { Join-Path $projectRoot "lavalink\start_lavalink.bat" }
    }
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Launcher is missing: $launcher" }

    if ($Service -eq "bot") {
        Stop-VerifiedProcess $CurrentProcessId "bot[\\/]index\.ts"
    } elseif ($Service -eq "web") {
        $processIds = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($processId in $processIds) { Stop-VerifiedProcess ([int]$processId) "next.*start.*127\.0\.0\.1.*3000" }
    } else {
        $port = if ($Service -eq "renderer") { 8765 } else { 2333 }
        $expected = if ($Service -eq "renderer") { "renderer([\\/]|\.)(server|start_renderer)|uvicorn" } else { "lavalink[\\/](run-local|Lavalink)|Lavalink\.jar" }
        $processIds = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($processId in $processIds) { Stop-VerifiedProcess ([int]$processId) $expected }
    }

    Start-Sleep -Seconds 2
    # Every bundled launcher understands --no-pause.  Supplying it is
    # important for background restarts: without it, an already-running or
    # later-stopped service leaves a hidden cmd.exe waiting for a key press.
    Start-Process -FilePath $launcher -ArgumentList "--no-pause" -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-RestartLog "Started from $launcher."
} catch {
    Write-RestartLog "ERROR: $($_.Exception.Message)"
    exit 1
}
