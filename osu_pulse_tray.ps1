$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PulseTrayInput {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);
}
'@

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPattern = [regex]::Escape($projectRoot)
$workDirectory = Join-Path $projectRoot "work"
$logPath = Join-Path $workDirectory "tray.log"
$mutexCreated = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\OsuPulseTrayIndicator", [ref]$mutexCreated)
if (-not $mutexCreated) { exit 0 }

New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

function Write-TrayLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" -Encoding UTF8
}

function Test-ListeningPort([int]$Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $connection = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $connection.AsyncWaitHandle.WaitOne(120)) { return $false }
        $client.EndConnect($connection)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-BotHeartbeat {
    $heartbeatPath = Join-Path $workDirectory "bot-heartbeat.json"
    if (-not (Test-Path -LiteralPath $heartbeatPath -PathType Leaf)) { return $false }
    return (Get-Item -LiteralPath $heartbeatPath).LastWriteTimeUtc -gt [DateTime]::UtcNow.AddSeconds(-20)
}

function Get-BotProcesses {
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "bot[\\/]index\.ts" })
}

function Get-PublicWebUrl {
    $urlPath = Join-Path $workDirectory "public-web-url.txt"
    if (Test-Path -LiteralPath $urlPath -PathType Leaf) {
        $candidate = [IO.File]::ReadAllText($urlPath).Trim()
        if ($candidate -match "^https://[a-z0-9.-]+$") { return $candidate }
    }
    return "http://127.0.0.1:3000"
}

function Get-TunnelProcesses {
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            ($_.Name -eq "cloudflared.exe" -and $_.CommandLine -match $projectPattern) -or
            ($_.Name -eq "powershell.exe" -and $_.CommandLine -match "start-public-tunnel\.ps1")
        })
}

function Test-WebProcess {
    return Test-ListeningPort 3000
}

function Test-ServiceRunning([string]$Service) {
    switch ($Service) {
        "database" { return Test-ListeningPort 54329 }
        "web" { return Test-WebProcess }
        "tunnel" { return [bool](Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $workDirectory "public-web-url.txt") -PathType Leaf) }
        "bot" { return Test-BotHeartbeat }
        "renderer" { return Test-ListeningPort 8765 }
        "lavalink" { return Test-ListeningPort 2333 }
    }
    return $false
}

function Get-PostgresControl {
    $pgRoot = Join-Path $env:ProgramFiles "PostgreSQL"
    $version = Get-ChildItem -LiteralPath $pgRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Name -replace "\D", "") } -Descending |
        Select-Object -First 1
    if (-not $version) { return $null }
    $control = Join-Path $version.FullName "bin\pg_ctl.exe"
    $data = Join-Path $version.FullName "data"
    if (-not (Test-Path -LiteralPath $control) -or -not (Test-Path -LiteralPath $data)) { return $null }
    return @{ Control = $control; Data = $data }
}

function Get-ServiceLauncher([string]$Service) {
    switch ($Service) {
        "web" { return Join-Path $projectRoot "start_web_ui.bat" }
        "tunnel" { return Join-Path $projectRoot "start_public_tunnel.bat" }
        "bot" { return Join-Path $projectRoot "bot\start_bot.bat" }
        "renderer" { return Join-Path $projectRoot "renderer\start_renderer.bat" }
        "lavalink" { return Join-Path $projectRoot "lavalink\start_lavalink.bat" }
    }
}

function Start-PulseService([string]$Service) {
    if (Test-ServiceRunning $Service) { return }
    if ($Service -eq "database") {
        $postgres = Get-PostgresControl
        if (-not $postgres) { throw "PostgreSQL が見つかりません。" }
        & $postgres.Control start -D $postgres.Data -w | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "PostgreSQL を起動できませんでした。" }
        Write-TrayLog "START database"
        return
    }
    $launcher = Get-ServiceLauncher $Service
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
        throw "起動ファイルがありません: $launcher"
    }
    Start-Process -FilePath $launcher -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-TrayLog "START $Service"
}

function Get-ServiceProcessIds([string]$Service) {
    if ($Service -eq "bot") {
        return @((Get-BotProcesses | Select-Object -ExpandProperty ProcessId))
    }
    if ($Service -eq "lavalink") {
        return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -match $projectPattern -and
                (($_.Name -eq "java.exe" -and $_.CommandLine -match "Lavalink\.jar") -or
                 ($_.Name -eq "node.exe" -and $_.CommandLine -match "lavalink[\\/]run-local"))
            } |
            Select-Object -ExpandProperty ProcessId -Unique)
    }
    if ($Service -eq "tunnel") {
        return @((Get-TunnelProcesses | Select-Object -ExpandProperty ProcessId -Unique))
    }
    if ($Service -eq "web") {
        return @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
    }
    $port = if ($Service -eq "renderer") { 8765 } else { 2333 }
    return @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-PulseService([string]$Service) {
    if ($Service -eq "database") {
        if (-not (Test-ServiceRunning $Service)) { return }
        $postgres = Get-PostgresControl
        if (-not $postgres) { throw "PostgreSQL が見つかりません。" }
        & $postgres.Control stop -D $postgres.Data -m fast -w | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "PostgreSQL を停止できませんでした。" }
        Write-TrayLog "STOP database"
        return
    }
    foreach ($processId in (Get-ServiceProcessIds $Service)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $process) { continue }
        $servicePattern = switch ($Service) {
            "bot" { "bot[\\/]index\.ts" }
            "web" { "next(?:\.exe|\.cmd|[\\/].*next).*start|next-server" }
            "tunnel" { "cloudflared|start-public-tunnel\.ps1" }
            "renderer" { "renderer[\\/].*(?:server|start_renderer)|uvicorn" }
            "lavalink" { "Lavalink\.jar|lavalink[\\/]run-local" }
        }
        if ($process.CommandLine -notmatch $servicePattern) {
            Write-TrayLog "REFUSED STOP $Service PID=$processId command did not match"
            continue
        }
        if ($process.CommandLine -notmatch $projectPattern -and $Service -ne "bot") {
            Write-TrayLog "REFUSED STOP $Service PID=$processId outside project"
            continue
        }
        Stop-Process -Id ([int]$processId) -Force -ErrorAction Stop
        Write-TrayLog "STOP $Service PID=$processId"
    }
}

function Restart-PulseService([string]$Service) {
    Stop-PulseService $Service
    Start-Sleep -Seconds 2
    Start-PulseService $Service
}

function Invoke-TrayAction([scriptblock]$Action, [string]$SuccessMessage) {
    try {
        & $Action
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notifyIcon.BalloonTipTitle = "osu! Pulse"
        $notifyIcon.BalloonTipText = $SuccessMessage
        $notifyIcon.ShowBalloonTip(2500)
    } catch {
        Write-TrayLog "ERROR $($_.Exception.Message)"
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Error
        $notifyIcon.BalloonTipTitle = "osu! Pulse 操作エラー"
        $notifyIcon.BalloonTipText = $_.Exception.Message
        $notifyIcon.ShowBalloonTip(4000)
    }
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Text = "osu! Pulse - 状態確認中"
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.AutoClose = $true
# Keep submenus usable while detecting clicks outside the entire menu tree.
function Test-MenuContainsPointer($DropDown, [System.Drawing.Point]$Point) {
    if ($DropDown.Visible -and $DropDown.Bounds.Contains($Point)) { return $true }
    foreach ($item in $DropDown.Items) {
        if ($item -is [System.Windows.Forms.ToolStripDropDownItem] -and $item.HasDropDownItems -and $item.DropDown.Visible) {
            if (Test-MenuContainsPointer $item.DropDown $Point) { return $true }
        }
    }
    return $false
}
$dismissTimer = New-Object System.Windows.Forms.Timer
$dismissTimer.Interval = 50
$script:previousTrayButtons = 0
$menu.Add_Opened({
    [void][PulseTrayInput]::SetForegroundWindow($menu.Handle)
    $script:previousTrayButtons = 3
    $dismissTimer.Start()
})
$menu.Add_Closed({ $dismissTimer.Stop() })
$dismissTimer.Add_Tick({
    $buttons = 0
    if (([PulseTrayInput]::GetAsyncKeyState(1) -band 0x8000) -ne 0) { $buttons += 1 }
    if (([PulseTrayInput]::GetAsyncKeyState(2) -band 0x8000) -ne 0) { $buttons += 2 }
    $pressed = $buttons -band (-bnot $script:previousTrayButtons)
    $script:previousTrayButtons = $buttons
    $escape = ([PulseTrayInput]::GetAsyncKeyState(27) -band 0x8000) -ne 0
    if ($escape -or ($pressed -ne 0 -and -not (Test-MenuContainsPointer $menu ([System.Windows.Forms.Cursor]::Position)))) {
        $menu.Close([System.Windows.Forms.ToolStripDropDownCloseReason]::AppClicked)
    }
})
$statusItem = $menu.Items.Add("状態を確認中...")
$statusItem.Enabled = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$openUi = $menu.Items.Add("Web UIを開く")
$openUi.Add_Click({ Start-Process "$(Get-PublicWebUrl)/dashboard/command-center" })
$copyUiUrl = $menu.Items.Add("公開URLをコピー")
$copyUiUrl.Add_Click({
    [System.Windows.Forms.Clipboard]::SetText((Get-PublicWebUrl))
    $notifyIcon.BalloonTipTitle = "osu! Pulse"
    $notifyIcon.BalloonTipText = "現在のWeb UI URLをコピーしました。"
    $notifyIcon.ShowBalloonTip(2000)
})
$openLogs = $menu.Items.Add("ログフォルダを開く")
$openLogs.Add_Click({ Start-Process explorer.exe -ArgumentList $workDirectory })
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$labels = @{ database = "Local PostgreSQL"; web = "Local Web UI"; tunnel = "Cloudflare Tunnel"; bot = "Discord Bot"; renderer = "Renderer"; lavalink = "Lavalink" }
foreach ($service in @("database", "web", "tunnel", "bot", "renderer", "lavalink")) {
    $serviceName = $service
    $serviceMenu = New-Object System.Windows.Forms.ToolStripMenuItem($labels[$service])
    $startItem = $serviceMenu.DropDownItems.Add("起動")
    $startItem.Add_Click({ Invoke-TrayAction { Start-PulseService $serviceName } "$($labels[$serviceName])を起動しました。" }.GetNewClosure())
    $restartItem = $serviceMenu.DropDownItems.Add("再起動")
    $restartItem.Add_Click({ Invoke-TrayAction { Restart-PulseService $serviceName } "$($labels[$serviceName])を再起動しました。" }.GetNewClosure())
    $stopItem = $serviceMenu.DropDownItems.Add("停止")
    $stopItem.Add_Click({ Invoke-TrayAction { Stop-PulseService $serviceName } "$($labels[$serviceName])を停止しました。" }.GetNewClosure())
    [void]$menu.Items.Add($serviceMenu)
}

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$startAll = $menu.Items.Add("すべて起動")
$startAll.Add_Click({ Invoke-TrayAction { foreach ($service in @("database", "web", "tunnel", "renderer", "lavalink", "bot")) { Start-PulseService $service } } "すべてのサービスを起動しました。" })
$stopAll = $menu.Items.Add("すべて停止")
$stopAll.Add_Click({
    if ([System.Windows.Forms.MessageBox]::Show("Bot・Renderer・Lavalink・Tunnel・Web UI・DBをすべて停止しますか？", "osu! Pulse", "YesNo", "Warning") -eq "Yes") {
        Invoke-TrayAction { foreach ($service in @("bot", "renderer", "lavalink", "tunnel", "web", "database")) { Stop-PulseService $service } } "すべてのサービスを停止しました。"
    }
})
$exitItem = $menu.Items.Add("インジケーターを終了")
$exitItem.Add_Click({
    $menu.Close()
    $notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::ExitThread()
})
$closeMenuItem = $menu.Items.Add("メニューを閉じる")
$closeMenuItem.Add_Click({ $menu.Close() })

$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Add_DoubleClick({ Start-Process "$(Get-PublicWebUrl)/dashboard/command-center" })

function Update-TrayStatus {
    $database = Test-ServiceRunning "database"
    $web = Test-ServiceRunning "web"
    $tunnel = Test-ServiceRunning "tunnel"
    $bot = Test-ServiceRunning "bot"
    $renderer = Test-ServiceRunning "renderer"
    $lavalink = Test-ServiceRunning "lavalink"
    $online = @($database, $web, $tunnel, $bot, $renderer, $lavalink).Where({ $_ }).Count
    $statusItem.Text = "DB $(if ($database) {'●'} else {'○'})  Web $(if ($web) {'●'} else {'○'})  Tunnel $(if ($tunnel) {'●'} else {'○'})  Bot $(if ($bot) {'●'} else {'○'})  Renderer $(if ($renderer) {'●'} else {'○'})  Lavalink $(if ($lavalink) {'●'} else {'○'})"
    $notifyIcon.Text = "osu! Pulse - $online/6 サービス稼働"
    $notifyIcon.Icon = if ($online -eq 6) { [System.Drawing.SystemIcons]::Information } elseif ($online -eq 0) { [System.Drawing.SystemIcons]::Error } else { [System.Drawing.SystemIcons]::Warning }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ if (-not $menu.Visible) { Update-TrayStatus } })
$timer.Start()
Update-TrayStatus
Write-TrayLog "Tray indicator started."

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    $dismissTimer.Stop()
    $dismissTimer.Dispose()
    $timer.Stop()
    $timer.Dispose()
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    $menu.Dispose()
    $mutex.ReleaseMutex()
    $mutex.Dispose()
    Write-TrayLog "Tray indicator stopped."
}
