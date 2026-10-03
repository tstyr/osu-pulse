$ErrorActionPreference = "Continue"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$workDirectory = Join-Path $projectRoot "work"
$logPath = Join-Path $workDirectory "watchdog.log"
$mutexCreated = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\OsuPulseWatchdog", [ref]$mutexCreated)
if (-not $mutexCreated) { exit 0 }
$failureCounts = @{ Database = 0; Web = 0; Tunnel = 0; Renderer = 0; Lavalink = 0; Bot = 0 }
$lastStarts = @{ Database = [DateTime]::MinValue; Web = [DateTime]::MinValue; Tunnel = [DateTime]::MinValue; Renderer = [DateTime]::MinValue; Lavalink = [DateTime]::MinValue; Bot = [DateTime]::MinValue }
$lastDatabaseSnapshot = [DateTime]::MinValue
$lastMountAttempt = [DateTime]::MinValue

New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

$trayScript = Join-Path $projectRoot "osu_pulse_tray.ps1"
if (Test-Path -LiteralPath $trayScript -PathType Leaf) {
    Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$trayScript`"") -WorkingDirectory $projectRoot -WindowStyle Hidden
}

function Write-WatchdogLog([string]$message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message" -Encoding UTF8
}

function Test-ListeningPort([int]$port) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $connection = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        if (-not $connection.AsyncWaitHandle.WaitOne(150)) { return $false }
        $client.EndConnect($connection)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-BotProcess {
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

function Test-SharedStorage {
    $sharedRoot = Get-ConfiguredSharedRoot
    if (-not $sharedRoot) { return $true }
    return Test-Path -LiteralPath $sharedRoot -PathType Container
}

function Test-WebProcess {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -Method Get -TimeoutSec 5
        return $health.ok -eq $true
    } catch {
        return $false
    }
}

function Test-RendererProcess {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:8765/health" -Method Get -UseBasicParsing -TimeoutSec 5 | Out-Null
        return $true
    } catch {
        # A protected renderer answers an unauthenticated probe with 401. That
        # still proves the HTTP event loop is responsive.
        $response = $_.Exception.Response
        if ($response -and [int]$response.StatusCode -eq 401) { return $true }
        return $false
    }
}

function Test-TunnelProcess {
    $urlPath = Join-Path $workDirectory "public-web-url.txt"
    if (-not [bool](Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue)) { return $false }
    if (-not (Test-Path -LiteralPath $urlPath -PathType Leaf)) { return $false }
    $candidate = [IO.File]::ReadAllText($urlPath).Trim()
    if ($candidate -notmatch "^https://[a-z0-9-]+\.trycloudflare\.com$") { return $false }
    try {
        $health = Invoke-RestMethod -Uri "$candidate/api/health" -Method Get -TimeoutSec 5
        return $health.ok -eq $true
    } catch {
        return $false
    }
}

function Start-HiddenService([string]$name, [string]$relativeLauncher) {
    if ($name -eq "Database") {
        if (((Get-Date) - $lastStarts[$name]).TotalMinutes -lt 5) { return }
        $pgRoot = Join-Path $env:ProgramFiles "PostgreSQL"
        $version = Get-ChildItem -LiteralPath $pgRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object { [int]($_.Name -replace "\D", "") } -Descending |
            Select-Object -First 1
        if (-not $version) {
            Write-WatchdogLog "ERROR: PostgreSQL installation is missing."
            return
        }
        $control = Join-Path $version.FullName "bin\pg_ctl.exe"
        $data = Join-Path $version.FullName "data"
        & $control start -D $data -w | Out-Null
        $lastStarts[$name] = Get-Date
        $failureCounts[$name] = 0
        Write-WatchdogLog "RECOVERY: Started local PostgreSQL."
        return
    }
    if ($name -eq "Web" -or $name -eq "Renderer") {
        if (((Get-Date) - $lastStarts[$name]).TotalMinutes -lt 5) { return }
        $restartScript = Join-Path $projectRoot "scripts\restart-local-service.ps1"
        if (-not (Test-Path -LiteralPath $restartScript -PathType Leaf)) {
            Write-WatchdogLog "ERROR: $name restart script is missing: $restartScript"
            return
        }
        $serviceName = if ($name -eq "Web") { "web" } else { "renderer" }
        Start-Process -FilePath "powershell.exe" -ArgumentList @(
            "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
            "-File", "`"$restartScript`"", "-Service", $serviceName
        ) -WorkingDirectory $projectRoot -WindowStyle Hidden
        $lastStarts[$name] = Get-Date
        $failureCounts[$name] = 0
        Write-WatchdogLog "RECOVERY: Restarting unhealthy $name."
        return
    }
    $launcher = Join-Path $projectRoot $relativeLauncher
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
        Write-WatchdogLog "ERROR: $name launcher is missing: $launcher"
        return
    }
    if (((Get-Date) - $lastStarts[$name]).TotalMinutes -lt 5) { return }
    Start-Process -FilePath $launcher -ArgumentList "--no-pause" -WorkingDirectory $projectRoot -WindowStyle Hidden
    $lastStarts[$name] = Get-Date
    $failureCounts[$name] = 0
    Write-WatchdogLog "RECOVERY: Started $name."
}

try {
    Write-WatchdogLog "Supervisor and tray indicator started."
    while ($true) {
        try {
            $sharedReady = Test-SharedStorage
            if (-not $sharedReady -and ((Get-Date) - $lastMountAttempt).TotalMinutes -ge 1) {
                $lastMountAttempt = Get-Date
                try {
                    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot 'scripts\ensure-shared-storage.ps1')
                    $sharedReady = Test-SharedStorage
                } catch { Write-WatchdogLog "Shared storage recovery failed: $($_.Exception.Message)" }
            }
            $rendererReady = $false
            $botReady = $false
            if ($sharedReady) {
                $rendererReady = Test-RendererProcess
                $botReady = Test-BotProcess
            }
            $states = @{
                Database = Test-ListeningPort 54329
                Web = Test-WebProcess
                Tunnel = Test-TunnelProcess
                Renderer = $rendererReady
                Lavalink = Test-ListeningPort 2333
                Bot = $botReady
            }
            foreach ($name in @("Database", "Web", "Tunnel", "Renderer", "Lavalink", "Bot")) {
                if (-not $sharedReady -and ($name -eq "Renderer" -or $name -eq "Bot")) {
                    $failureCounts[$name] = 0
                    continue
                }
                if ($states[$name]) {
                    $failureCounts[$name] = 0
                    continue
                }
                $failureCounts[$name] += 1
                if ($failureCounts[$name] -ge 2) {
                    if ($name -eq "Tunnel" -and -not $states.Web) { continue }
                    $launcher = if ($name -eq "Web") { "start_web_ui.bat" } elseif ($name -eq "Tunnel") { "start_public_tunnel.bat" } elseif ($name -eq "Renderer") { "renderer\start_renderer.bat" } elseif ($name -eq "Lavalink") { "lavalink\start_lavalink.bat" } elseif ($name -eq "Bot") { "bot\start_bot.bat" } else { "" }
                    Start-HiddenService $name $launcher
                }
            }
            if ($sharedReady -and $states.Database -and ((Get-Date) - $lastDatabaseSnapshot).TotalMinutes -ge 5) {
                $syncScript = Join-Path $projectRoot "scripts\sync-shared-database.ps1"
                if (Test-Path -LiteralPath $syncScript -PathType Leaf) {
                    Start-Process -FilePath "powershell.exe" -ArgumentList @(
                        "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
                        "-File", "`"$syncScript`"", "-Mode", "Push"
                    ) -WorkingDirectory $projectRoot -WindowStyle Hidden
                    $lastDatabaseSnapshot = Get-Date
                }
            }
        } catch {
            Write-WatchdogLog "ERROR: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds 15
    }
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
