param([int]$PreviousProcessId = 0)
$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$launcher = Join-Path $projectRoot "bot\start_bot.bat"
$workDirectory = Join-Path $projectRoot "work"
$logPath = Join-Path $workDirectory "service-restarts.log"
New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Bot launcher is missing: $launcher" }
if ($PreviousProcessId -gt 0) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (Get-Process -Id $PreviousProcessId -ErrorAction SilentlyContinue) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "Previous Bot did not stop within 30 seconds." }
        Start-Sleep -Milliseconds 250
    }
}
Start-Process -FilePath $launcher -ArgumentList "--no-pause" -WorkingDirectory $projectRoot -WindowStyle Hidden
Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [bot] Replacement process started from $launcher." -Encoding UTF8
