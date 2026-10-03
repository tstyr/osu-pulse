param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Push", "Pull")]
    [string]$Mode,
    [string]$SharedRoot = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$envPath = Join-Path $projectRoot ".env.local"
$workPath = Join-Path $projectRoot "work"
$mutex = [Threading.Mutex]::new($false, "Local\OsuPulseSharedDatabaseSync")
$locked = $false

function Read-DotEnvValue([string]$Name) {
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { return $null }
    $line = [IO.File]::ReadAllLines($envPath) |
        Where-Object { $_ -match "^$([regex]::Escape($Name))=" } |
        Select-Object -Last 1
    if (-not $line) { return $null }
    $value = (($line -split "=", 2)[1]).Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq "'" -and $value[-1] -eq "'") -or ($value[0] -eq '"' -and $value[-1] -eq '"'))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    return $value
}

function Find-PostgresTool([string]$Name) {
    $workspaceTool = Join-Path $projectRoot "work\postgresql18-tools\bin\$Name.exe"
    if (Test-Path -LiteralPath $workspaceTool -PathType Leaf) { return $workspaceTool }
    $pgRoot = Join-Path $env:ProgramFiles "PostgreSQL"
    $candidate = Get-ChildItem -LiteralPath $pgRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Name -replace "\D", "") } -Descending |
        ForEach-Object { Join-Path $_.FullName "bin\$Name.exe" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if (-not $candidate) { throw "$Name.exe was not found." }
    return $candidate
}

function Get-DatabaseConnection {
    $databaseUrl = Read-DotEnvValue "DATABASE_URL"
    if (-not $databaseUrl) { throw "DATABASE_URL is not configured." }
    $uri = [Uri]$databaseUrl
    if ($uri.Scheme -notin @("postgres", "postgresql")) { throw "DATABASE_URL is not PostgreSQL." }
    if ($uri.Host -notin @('localhost', '127.0.0.1', '::1', '[::1]')) { throw 'Shared synchronization only supports the local PostgreSQL database.' }
    $userInfo = $uri.UserInfo -split ":", 2
    return [ordered]@{
        Host = $uri.Host
        Port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
        User = [Uri]::UnescapeDataString($userInfo[0])
        Password = if ($userInfo.Count -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { "" }
        Database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart("/"))
    }
}

function Invoke-PgTool([string]$Tool, [string[]]$Arguments, [Collections.IDictionary]$Connection) {
    $oldPassword = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = $Connection.Password
        & $Tool @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $Tool) failed with exit code $LASTEXITCODE." }
    } finally {
        $env:PGPASSWORD = $oldPassword
    }
}

function Invoke-SnapshotTool([string[]]$Arguments) {
    & node (Join-Path $PSScriptRoot 'shared-db-snapshot.mjs') @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Shared database snapshot validation failed. No database was overwritten.' }
}

try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked) {
        Write-Output "[SKIP] Another database synchronization is already running."
        exit 0
    }
    if (-not $SharedRoot) { $SharedRoot = Read-DotEnvValue "OSU_PULSE_SHARED_ROOT" }
    if (-not $SharedRoot -or -not (Test-Path -LiteralPath $SharedRoot -PathType Container)) {
        throw "Shared storage is unavailable: $SharedRoot"
    }

    New-Item -ItemType Directory -Path $workPath -Force | Out-Null
    $sharedDbPath = Join-Path $SharedRoot "backups\database"
    New-Item -ItemType Directory -Path $sharedDbPath -Force | Out-Null
    $statePath = Join-Path $workPath "shared-db-applied.id"
    $connection = Get-DatabaseConnection
    $common = @("--host", $connection.Host, "--port", [string]$connection.Port, "--username", $connection.User, "--dbname", $connection.Database)

    if ($Mode -eq "Push") {
        Invoke-SnapshotTool @('prepare-push', $sharedDbPath, $statePath)
        $pgDump = Find-PostgresTool "pg_dump"
        $temporaryPath = Join-Path $sharedDbPath "osu-pulse.$([Guid]::NewGuid().ToString('N')).tmp"
        try {
            Invoke-PgTool $pgDump (@("--format=custom", "--compress=6", "--no-owner", "--no-acl", "--file", $temporaryPath) + $common) $connection
            if ((Get-Item -LiteralPath $temporaryPath).Length -le 0) { throw "Database dump is empty." }
            $snapshotId = Invoke-SnapshotTool @('publish', $sharedDbPath, $statePath, $temporaryPath, 'windows')
            Write-Output "[OK] Shared database snapshot saved: $snapshotId"
        } finally {
            if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) { Remove-Item -LiteralPath $temporaryPath -Force }
        }
        exit 0
    }

    $snapshot = @(Invoke-SnapshotTool @('resolve-pull', $sharedDbPath))
    if ($snapshot.Count -eq 0) {
        Write-Output "[SKIP] No shared database snapshot exists yet."
        exit 0
    }
    $snapshotId = $snapshot[0]
    $dumpPath = $snapshot[1]
    $appliedId = if (Test-Path -LiteralPath $statePath -PathType Leaf) { [IO.File]::ReadAllText($statePath).Trim() } else { "" }
    if ($snapshotId -and $snapshotId -eq $appliedId) {
        Write-Output "[SKIP] Shared database snapshot is already applied: $snapshotId"
        exit 0
    }

    Invoke-SnapshotTool @('guard-restore', $projectRoot)

    $pgDump = Find-PostgresTool "pg_dump"
    $pgRestore = Find-PostgresTool "pg_restore"
    Invoke-PgTool $pgRestore @('--list', $dumpPath) $connection | Out-Null
    $safetyPath = Join-Path $workPath "db-safety"
    New-Item -ItemType Directory -Path $safetyPath -Force | Out-Null
    $safetyDump = Join-Path $safetyPath "before-shared-pull-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')).dump"
    Invoke-PgTool $pgDump (@("--format=custom", "--compress=6", "--no-owner", "--no-acl", "--file", $safetyDump) + $common) $connection
    Invoke-PgTool $pgRestore (@("--clean", "--if-exists", "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction") + $common + @($dumpPath)) $connection
    Invoke-SnapshotTool @('mark-applied', $sharedDbPath, $statePath, $snapshotId)
    Write-Output "[OK] Shared database snapshot restored: $snapshotId"
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
