$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$workDirectory = Join-Path $projectRoot "work"
$logPath = Join-Path $workDirectory "autostart.log"

New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

function Write-AutostartLog([string]$message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message" -Encoding UTF8
}

function Test-ListeningPort([int]$port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Start-HiddenLauncher([string]$relativePath, [string]$name) {
    $launcher = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
        Write-AutostartLog "ERROR: $name launcher is missing: $launcher"
        return
    }
    Start-Process -FilePath $launcher -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-AutostartLog "Started $name."
}

try {
    Start-Sleep -Seconds 15
    Write-AutostartLog "Windows sign-in startup began."

    if (Test-ListeningPort 8765) {
        Write-AutostartLog "Renderer is already running."
    } else {
        Start-HiddenLauncher "renderer\start_renderer.bat" "Renderer"
    }

    if (Test-ListeningPort 2333) {
        Write-AutostartLog "Lavalink is already running."
    } else {
        Start-HiddenLauncher "lavalink\start_lavalink.bat" "Lavalink"
    }

    $lavalinkDeadline = [DateTime]::UtcNow.AddSeconds(120)
    while (-not (Test-ListeningPort 2333) -and [DateTime]::UtcNow -lt $lavalinkDeadline) {
        Start-Sleep -Seconds 2
    }

    $botRunning = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "bot[\\/]index\.ts" } |
        Select-Object -First 1
    if ($botRunning) {
        Write-AutostartLog "Discord Bot is already running."
    } else {
        Start-HiddenLauncher "bot\start_bot.bat" "Discord Bot"
    }

    Write-AutostartLog "Windows sign-in startup finished."
} catch {
    Write-AutostartLog "ERROR: $($_.Exception.Message)"
    throw
}
