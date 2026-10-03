$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$workDirectory = Join-Path $projectRoot "work"
$urlPath = Join-Path $workDirectory "public-web-url.txt"
$logPath = Join-Path $workDirectory "cloudflared.log"
$cloudflared = (Get-Command cloudflared.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

function Test-PulseWebHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -Method Get -TimeoutSec 3
        return $health.ok -eq $true
    } catch {
        return $false
    }
}

function Test-PublicUrlHealth([string]$Candidate) {
    if ($Candidate -notmatch "^https://[a-z0-9-]+\.trycloudflare\.com$") { return $false }
    try {
        $health = Invoke-RestMethod -Uri "$Candidate/api/health" -Method Get -TimeoutSec 5
        return $health.ok -eq $true
    } catch {
        return $false
    }
}

$deadline = [DateTime]::UtcNow.AddSeconds(120)
while (-not (Test-PulseWebHealth)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw "Local Web UI did not start within 120 seconds." }
    Start-Sleep -Seconds 2
}

$projectPattern = [regex]::Escape($projectRoot)
$existingTunnel = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "cloudflared.exe" -and $_.CommandLine -match $projectPattern } |
    Select-Object -First 1
if ($existingTunnel) {
    $existingUrl = if (Test-Path -LiteralPath $urlPath -PathType Leaf) {
        [IO.File]::ReadAllText($urlPath).Trim()
    } else { "" }
    if (Test-PublicUrlHealth $existingUrl) {
        Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Tunnel is healthy as PID $($existingTunnel.ProcessId)." -Encoding UTF8
        exit 0
    }
    # A quick tunnel can retain a process after its generated hostname has
    # stopped resolving. Replace that verified project process instead of
    # treating process existence as service health.
    Stop-Process -Id ([int]$existingTunnel.ProcessId) -Force -ErrorAction Stop
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Replacing unhealthy tunnel PID $($existingTunnel.ProcessId)." -Encoding UTF8
    Start-Sleep -Seconds 2
}

if (Test-Path -LiteralPath $urlPath -PathType Leaf) {
    Remove-Item -LiteralPath $urlPath -Force
}

$activeUrl = $null
try {
    # Windows PowerShell 5 exposes native stderr lines as ErrorRecord objects.
    # cloudflared writes its normal startup information to stderr, so keep those
    # lines in the log without treating them as terminating PowerShell errors.
    $ErrorActionPreference = "Continue"
    & $cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:3000 --logfile $logPath 2>&1 |
        ForEach-Object {
            $line = [string]$_
            Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
            if (-not $activeUrl -and $line -match "https://[a-z0-9-]+\.trycloudflare\.com") {
                $activeUrl = $Matches[0].TrimEnd("/")
                $temporaryPath = "$urlPath.new"
                [IO.File]::WriteAllText($temporaryPath, "$activeUrl`r`n", [Text.UTF8Encoding]::new($false))
                Move-Item -LiteralPath $temporaryPath -Destination $urlPath -Force
                Add-Content -LiteralPath $logPath -Value "Published osu! Pulse at $activeUrl" -Encoding UTF8
                $syncScript = Join-Path $projectRoot "scripts\sync-vercel-web-proxy.ps1"
                if (Test-Path -LiteralPath $syncScript -PathType Leaf) {
                    Start-Process -FilePath "powershell.exe" -ArgumentList @(
                        "-NoProfile",
                        "-WindowStyle", "Hidden",
                        "-ExecutionPolicy", "Bypass",
                        "-File", "`"$syncScript`"",
                        "-Origin", "`"$activeUrl`""
                    ) -WorkingDirectory $projectRoot -WindowStyle Hidden
                    Add-Content -LiteralPath $logPath -Value "Vercel proxy synchronization started." -Encoding UTF8
                }
            }
        }
    $tunnelExitCode = $LASTEXITCODE
    exit $tunnelExitCode
} finally {
    if ($activeUrl -and (Test-Path -LiteralPath $urlPath -PathType Leaf)) {
        $current = [IO.File]::ReadAllText($urlPath).Trim()
        if ($current -eq $activeUrl) { Remove-Item -LiteralPath $urlPath -Force }
    }
}
