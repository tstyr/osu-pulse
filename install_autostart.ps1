param(
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$taskName = "osu! Pulse Auto Start"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $projectRoot "autostart_osu_pulse.ps1"

if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "[OK] Removed the osu! Pulse auto-start task."
    } else {
        Write-Host "[INFO] The osu! Pulse auto-start task is not installed."
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "Auto-start launcher is missing: $launcher"
}

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershellPath = (Get-Command powershell.exe).Source
$actionArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $actionArguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $taskName `
    -Description "Starts the osu! Pulse Renderer, Lavalink, and Discord Bot after Windows sign-in." `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

Write-Host "[OK] osu! Pulse will start automatically after Windows sign-in."
Write-Host "Task: $taskName"
Write-Host "Launcher: $launcher"
Write-Host "Remove: powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Remove"
