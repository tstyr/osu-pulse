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

function Test-BotHeartbeat {
    $heartbeatPath = Join-Path $workDirectory "bot-heartbeat.json"
    if (-not (Test-Path -LiteralPath $heartbeatPath -PathType Leaf)) { return $false }
    return (Get-Item -LiteralPath $heartbeatPath).LastWriteTimeUtc -gt [DateTime]::UtcNow.AddSeconds(-20)
}

function Get-ConfiguredSharedRoot {
    $envPath = Join-Path $projectRoot ".env.local"
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { return $null }
    $line = [IO.File]::ReadAllLines($envPath) |
        Where-Object { $_ -match "^OSU_PULSE_SHARED_ROOT=" } |
        Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1]).Trim().Trim('"').Trim("'")
}

function Test-ProjectProcess([string]$name, [string]$pattern) {
    $escapedRoot = [regex]::Escape($projectRoot)
    return [bool](Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq $name -and $_.CommandLine -match $escapedRoot -and $_.CommandLine -match $pattern } |
        Select-Object -First 1)
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

function Start-HiddenPowerShell([string]$relativePath, [string]$name, [switch]$Sta) {
    $script = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
        Write-AutostartLog "ERROR: $name script is missing: $script"
        return
    }
    $arguments = @("-NoProfile")
    if ($Sta) { $arguments += "-STA" }
    $arguments += @("-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$script`"")
    Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-AutostartLog "Started $name."
}

function Wait-Until([scriptblock]$probe, [int]$seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $probe) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

try {
    Start-Sleep -Seconds 15
    Write-AutostartLog "Windows sign-in startup began."

    $sharedRoot = Get-ConfiguredSharedRoot
    if ($sharedRoot -and -not (Test-Path -LiteralPath $sharedRoot)) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot 'scripts\ensure-shared-storage.ps1')
    }
    $sharedReady = $true
    if ($sharedRoot) {
        $sharedReady = Wait-Until { Test-Path -LiteralPath $sharedRoot -PathType Container } 60
        if ($sharedReady) {
            Write-AutostartLog "Shared storage is ready: $sharedRoot"
        } else {
            Write-AutostartLog "ERROR: Shared storage was not mounted within 60 seconds: $sharedRoot"
        }
    }

    # The database must be available before the shared snapshot is restored.
    # Other services start only after this one-time boot synchronization, so
    # they cannot observe a half-restored schema.
    if (-not (Test-ListeningPort 54329)) { Start-HiddenPowerShell "scripts\ensure-local-postgres.ps1" "local PostgreSQL" }
    $databaseReady = Wait-Until { Test-ListeningPort 54329 } 60
    if ($sharedReady -and $databaseReady) {
        try {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\sync-shared-database.ps1") -Mode Pull
            if ($LASTEXITCODE -eq 0) { Write-AutostartLog "Shared database startup synchronization completed." }
            else { throw "Shared database startup synchronization failed with exit code $LASTEXITCODE." }
        } catch {
            Write-AutostartLog "ERROR: Shared database startup synchronization failed: $($_.Exception.Message)"
            throw
        }
    }

    # Start independent application services in parallel. In particular,
    # never make the Discord Bot wait for Web UI, Renderer or Lavalink.
    if (-not (Test-ListeningPort 3000)) { Start-HiddenLauncher "start_web_ui.bat" "Web UI" }
    if ($sharedReady -and -not (Test-ListeningPort 8765)) { Start-HiddenLauncher "renderer\start_renderer.bat" "Renderer" }
    if (-not (Test-ListeningPort 2333)) { Start-HiddenLauncher "lavalink\start_lavalink.bat" "Lavalink" }

    if (Test-BotHeartbeat) { Write-AutostartLog "Discord Bot is already running." }
    elseif ($sharedReady) { Start-HiddenLauncher "bot\start_bot.bat" "Discord Bot" }
    else { Write-AutostartLog "Discord Bot and Renderer were not started because shared storage is unavailable." }

    if (-not (Test-ProjectProcess "powershell.exe" "watchdog_osu_pulse\.ps1")) {
        Start-HiddenPowerShell "watchdog_osu_pulse.ps1" "Supervisor"
    }
    if (-not (Test-ProjectProcess "powershell.exe" "osu_pulse_tray\.ps1")) {
        Start-HiddenPowerShell "osu_pulse_tray.ps1" "tray indicator" -Sta
    }

    if ((Wait-Until { Test-ListeningPort 3000 } 180) -and
        -not (Test-ProjectProcess "cloudflared.exe" "tunnel.*127\.0\.0\.1:3000")) {
        Start-HiddenLauncher "start_public_tunnel.bat" "Cloudflare Tunnel"
    }

    Write-AutostartLog "Windows sign-in startup completed; resident monitor is active."

    # Task Scheduler owns processes launched by this task. Keep the bootstrap
    # process alive so Windows does not tear down the Bot and other workers as
    # soon as the one-time startup phase completes. The watchdog handles the
    # individual recovery checks; this loop also revives the watchdog itself.
    while ($true) {
        Start-Sleep -Seconds 30
        if (-not (Test-ProjectProcess "powershell.exe" "watchdog_osu_pulse\.ps1")) {
            Start-HiddenPowerShell "watchdog_osu_pulse.ps1" "Supervisor"
        }
    }
} catch {
    Write-AutostartLog "ERROR: $($_.Exception.Message)"
    throw
}
