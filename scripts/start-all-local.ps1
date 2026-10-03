param(
    [switch]$Check,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$workDirectory = Join-Path $projectRoot "work"
$launcherLog = Join-Path $workDirectory "launcher.log"
$heartbeatPath = Join-Path $workDirectory "bot-heartbeat.json"
$publicUrlPath = Join-Path $workDirectory "public-web-url.txt"
$mutexCreated = $false
$mutex = $null

New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

function Write-LauncherLog([string]$Message) {
    Add-Content -LiteralPath $launcherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" -Encoding UTF8
}

function Test-TcpPort([int]$Port, [int]$TimeoutMilliseconds = 250) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $connection = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $connection.AsyncWaitHandle.WaitOne($TimeoutMilliseconds)) { return $false }
        $client.EndConnect($connection)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-BotHeartbeat {
    if (-not (Test-Path -LiteralPath $heartbeatPath -PathType Leaf)) { return $false }
    return (Get-Item -LiteralPath $heartbeatPath).LastWriteTimeUtc -gt [DateTime]::UtcNow.AddSeconds(-20)
}

function Test-WebHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -Method Get -TimeoutSec 5
        return $health.ok -eq $true
    } catch {
        return $false
    }
}

function Test-ProjectProcess([string]$Name, [string]$Pattern) {
    $escapedRoot = [regex]::Escape($projectRoot)
    return [bool](Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq $Name -and $_.CommandLine -match $escapedRoot -and $_.CommandLine -match $Pattern } |
        Select-Object -First 1)
}

function Test-PublicTunnel {
    return (Test-ProjectProcess "cloudflared.exe" "tunnel.*127\.0\.0\.1:3000")
}

function Test-PublicUrl {
    if (-not (Test-PublicTunnel)) { return $false }
    if (-not (Test-Path -LiteralPath $publicUrlPath -PathType Leaf)) { return $false }
    $candidate = [IO.File]::ReadAllText($publicUrlPath).Trim()
    if ($candidate -notmatch "^https://[a-z0-9-]+\.trycloudflare\.com$") { return $false }
    try {
        $health = Invoke-RestMethod -Uri "$candidate/api/health" -Method Get -TimeoutSec 5
        return $health.ok -eq $true
    } catch {
        return $false
    }
}

function Test-Supervisor {
    return Test-ProjectProcess "powershell.exe" "watchdog_osu_pulse\.ps1"
}

function Test-TrayIndicator {
    return Test-ProjectProcess "powershell.exe" "osu_pulse_tray\.ps1"
}

function Start-Launcher([string]$Name, [string]$RelativePath, [switch]$Sta) {
    $path = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Name launcher is missing: $path" }
    if ([IO.Path]::GetExtension($path) -ieq ".ps1") {
        $arguments = @("-NoProfile")
        if ($Sta) { $arguments += "-STA" }
        $arguments += @("-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$path`"")
        Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden
    } else {
        Start-Process -FilePath $path -ArgumentList "--no-pause" -WorkingDirectory $projectRoot -WindowStyle Hidden
    }
    Write-LauncherLog "START: $Name from $RelativePath"
}

function Restart-WebUi {
    $restartScript = Join-Path $projectRoot "scripts\restart-local-service.ps1"
    if (-not (Test-Path -LiteralPath $restartScript -PathType Leaf)) { throw "Web restart script is missing: $restartScript" }
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
        "-File", "`"$restartScript`"", "-Service", "web"
    ) -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-LauncherLog "RESTART: Web UI was listening but failed its HTTP health check."
}

function Wait-Service([scriptblock]$Probe, [int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Probe) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Service-State([bool]$Running) {
    if ($Running) { return "ONLINE" }
    return "OFFLINE"
}

function Show-Status {
    $database = Test-TcpPort 54329
    $web = Test-WebHealth
    $renderer = Test-TcpPort 8765
    $lavalink = Test-TcpPort 2333
    $bot = Test-BotHeartbeat
    $tunnel = Test-PublicTunnel
    $publicReady = Test-PublicUrl
    $supervisor = Test-Supervisor
    $tray = Test-TrayIndicator
    $publicUrl = if ($publicReady) {
        [IO.File]::ReadAllText($publicUrlPath).Trim()
    } else { "-" }

    Write-Host ""
    Write-Host "=============================================="
    Write-Host "             osu! Pulse Status"
    Write-Host "=============================================="
    Write-Host ("Database  : {0}  127.0.0.1:54329" -f (Service-State $database))
    Write-Host ("Web UI    : {0}  http://127.0.0.1:3000" -f (Service-State $web))
    Write-Host ("Renderer  : {0}  127.0.0.1:8765" -f (Service-State $renderer))
    Write-Host ("Lavalink  : {0}  127.0.0.1:2333" -f (Service-State $lavalink))
    Write-Host ("Discord   : {0}" -f (Service-State $bot))
    Write-Host ("Tunnel    : {0}" -f (Service-State $tunnel))
    Write-Host ("Supervisor: {0}" -f (Service-State $supervisor))
    Write-Host ("Indicator : {0}" -f (Service-State $tray))
    Write-Host ("Public URL: {0}" -f $publicUrl)
    Write-Host "Logs      : $workDirectory"

    return $database -and $web -and $renderer -and $lavalink -and $bot -and $publicReady -and $supervisor -and $tray
}

function Invoke-PrerequisiteCheck {
    $checks = @(
        @{ Name = "Web UI"; Path = "start_web_ui.bat" },
        @{ Name = "Cloudflare Tunnel"; Path = "start_public_tunnel.bat" },
        @{ Name = "Renderer"; Path = "renderer\start_renderer.bat" },
        @{ Name = "Lavalink"; Path = "lavalink\start_lavalink.bat" },
        @{ Name = "Discord Bot"; Path = "bot\start_bot.bat" },
        @{ Name = "Supervisor"; Path = "watchdog_osu_pulse.ps1" },
        @{ Name = "Tray Indicator"; Path = "osu_pulse_tray.ps1" }
    )
    $failed = $false
    foreach ($item in $checks) {
        $path = Join-Path $projectRoot $item.Path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            Write-Host "[ERROR] $($item.Name): launcher not found"
            $failed = $true
            continue
        }
        if ([IO.Path]::GetExtension($path) -ieq ".bat") {
            & $path --check
            if ($LASTEXITCODE -ne 0) { $failed = $true }
        } else {
            Write-Host "[OK] $($item.Name) launcher is ready."
        }
    }
    if ($failed) { throw "One or more prerequisites are missing." }
    Write-Host "[OK] All prerequisites are ready."
}

try {
    Set-Location -LiteralPath $projectRoot
    if ($Check) {
        Invoke-PrerequisiteCheck
        exit 0
    }
    if ($Status) {
        if (Show-Status) { exit 0 } else { exit 1 }
    }

    $mutex = [Threading.Mutex]::new($true, "Local\OsuPulseLauncher", [ref]$mutexCreated)
    if (-not $mutexCreated) {
        Write-Host "[INFO] Another osu! Pulse startup is already running."
        Show-Status | Out-Null
        exit 0
    }

    Write-Host "=============================================="
    Write-Host "             osu! Pulse Launcher"
    Write-Host "=============================================="
    Write-Host "Starting missing services. Existing services will be reused."
    Write-LauncherLog "Startup requested."

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'ensure-shared-storage.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Shared USB is unavailable; startup stopped to protect its database.' }
    & (Join-Path $projectRoot "scripts\ensure-local-postgres.ps1")
    if (-not (Test-TcpPort 54329)) { throw "Local PostgreSQL did not become ready." }
    Write-Host "[OK] Database"

    $sharedLine = [IO.File]::ReadAllLines((Join-Path $projectRoot '.env.local')) | Where-Object { $_ -match '^OSU_PULSE_SHARED_ROOT=' } | Select-Object -Last 1
    if ($sharedLine -and -not (Test-BotHeartbeat) -and -not (Test-TcpPort 3000) -and -not (Test-TcpPort 8765)) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-shared-database.ps1') -Mode Pull
        if ($LASTEXITCODE -ne 0) { throw 'Startup database synchronization failed; applications were not started.' }
        Write-Host '[OK] Shared database synchronized'
    }

    if (-not (Test-WebHealth)) {
        if (Test-TcpPort 3000) { Restart-WebUi } else { Start-Launcher "Web UI" "start_web_ui.bat" }
    }
    if (-not (Test-TcpPort 8765)) { Start-Launcher "Renderer" "renderer\start_renderer.bat" }
    if (-not (Test-TcpPort 2333)) { Start-Launcher "Lavalink" "lavalink\start_lavalink.bat" }
    if (-not (Test-BotHeartbeat)) { Start-Launcher "Discord Bot" "bot\start_bot.bat" }

    $webReady = Wait-Service { Test-WebHealth } 180
    $rendererReady = Wait-Service { Test-TcpPort 8765 } 90
    $lavalinkReady = Wait-Service { Test-TcpPort 2333 } 120

    Write-Host $(if ($webReady) { "[OK] Web UI" } else { "[WARN] Web UI timeout" })
    Write-Host $(if ($rendererReady) { "[OK] Renderer" } else { "[WARN] Renderer timeout" })
    Write-Host $(if ($lavalinkReady) { "[OK] Lavalink" } else { "[WARN] Lavalink timeout; Bot will still start" })

    if ($webReady -and -not (Test-PublicTunnel)) {
        Start-Launcher "Cloudflare Tunnel" "start_public_tunnel.bat"
    }

    if (-not (Test-Supervisor)) {
        Start-Launcher "Supervisor" "watchdog_osu_pulse.ps1"
    }

    Wait-Service { Test-BotHeartbeat } 45 | Out-Null
    if ($webReady) { Wait-Service { Test-PublicUrl } 60 | Out-Null }
    Wait-Service { Test-Supervisor } 10 | Out-Null
    if (-not (Wait-Service { Test-TrayIndicator } 5)) {
        Start-Launcher "Tray Indicator" "osu_pulse_tray.ps1" -Sta
        Wait-Service { Test-TrayIndicator } 10 | Out-Null
    }
    $healthy = Show-Status
    if (-not $healthy) {
        Write-LauncherLog "Startup sequence finished with one or more offline services."
        exit 1
    }
    Write-LauncherLog "Startup sequence completed."
    exit 0
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    Write-LauncherLog "ERROR: $($_.Exception.Message)"
    exit 1
} finally {
    if ($mutex -and $mutexCreated) {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}
