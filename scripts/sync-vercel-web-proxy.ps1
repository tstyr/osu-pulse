param(
    [Parameter(Mandatory = $true)]
    [string]$Origin
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$workDirectory = Join-Path $projectRoot "work"
$logPath = Join-Path $workDirectory "vercel-proxy-sync.log"
$statePath = Join-Path $workDirectory "vercel-proxy-origin.txt"
$mutexCreated = $false
$mutex = $null

New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

function Write-SyncLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" -Encoding UTF8
}

try {
    $uri = [Uri]$Origin
    if ($uri.Scheme -ne "https" -or $uri.Host -notmatch "^[a-z0-9-]+\.trycloudflare\.com$") {
        throw "Only an HTTPS trycloudflare origin can be published."
    }
    $normalizedOrigin = $uri.GetLeftPart([UriPartial]::Authority).TrimEnd("/")

    $mutex = [Threading.Mutex]::new($true, "Local\OsuPulseVercelProxySync", [ref]$mutexCreated)
    if (-not $mutexCreated) {
        Write-SyncLog "SKIP: Another Vercel proxy sync is already running."
        exit 0
    }

    $previous = if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        [IO.File]::ReadAllText($statePath).Trim()
    } else { "" }
    if ($previous -eq $normalizedOrigin) {
        Write-SyncLog "SKIP: Vercel already points to $normalizedOrigin"
        exit 0
    }

    $vercel = (Get-Command vercel.cmd -ErrorAction Stop).Source
    Write-SyncLog "SYNC: Updating the Vercel proxy origin to $normalizedOrigin"
    # Windows PowerShell exposes normal native stderr output as ErrorRecord.
    # Vercel writes its banner/progress there even on success, so collect it
    # without allowing ErrorActionPreference=Stop to abort the synchronization.
    $ErrorActionPreference = "Continue"
    $environmentOutput = & $vercel env add LOCAL_WEB_ORIGIN production --value $normalizedOrigin --force --yes --no-sensitive 2>&1
    $environmentExitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    $environmentOutput | ForEach-Object { Write-SyncLog ([string]$_) }
    if ($environmentExitCode -ne 0) { throw "Vercel environment update failed with exit code $environmentExitCode." }

    $ErrorActionPreference = "Continue"
    $deploymentOutput = & $vercel deploy --prod --yes 2>&1
    $deploymentExitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    $deploymentOutput | ForEach-Object { Write-SyncLog ([string]$_) }
    if ($deploymentExitCode -ne 0) { throw "Vercel production deployment failed with exit code $deploymentExitCode." }

    [IO.File]::WriteAllText($statePath, "$normalizedOrigin`r`n", [Text.UTF8Encoding]::new($false))
    Write-SyncLog "OK: Vercel Web UI now proxies to the local PC."
} catch {
    Write-SyncLog "ERROR: $($_.Exception.Message)"
    exit 1
} finally {
    if ($mutex -and $mutexCreated) {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}
