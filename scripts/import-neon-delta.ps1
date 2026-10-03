param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"
$workDirectory = Join-Path $projectRoot "work"
$postgresRoot = Join-Path $env:ProgramFiles "PostgreSQL"

function Read-EnvValue([string]$Name) {
  foreach ($line in [IO.File]::ReadAllLines($envPath)) {
    if ($line -match ("^" + [regex]::Escape($Name) + "=(.*)$")) {
      $value = $Matches[1].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

function Convert-PostgresUrl([string]$Value) {
  $uri = [Uri]$Value
  $userInfo = $uri.UserInfo.Split(":", 2)
  return @{
    Host = $uri.Host
    Port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    User = [Uri]::UnescapeDataString($userInfo[0])
    Password = if ($userInfo.Count -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { "" }
    Database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart("/"))
  }
}

if (-not (Test-Path -LiteralPath $envPath)) { throw ".env.local is missing." }
$sourceUrl = Read-EnvValue "NEON_DATABASE_URL"
$targetUrl = Read-EnvValue "DATABASE_URL"
if (-not $sourceUrl) { throw "NEON_DATABASE_URL is not configured." }
if (-not $targetUrl -or $targetUrl -notmatch "@(localhost|127\.0\.0\.1|\[::1\])[:/]") {
  throw "DATABASE_URL must point to local PostgreSQL before importing a Neon delta."
}

$versionDirectory = Get-ChildItem -LiteralPath $postgresRoot -Directory |
  Sort-Object { [int]($_.Name -replace "\D", "") } -Descending |
  Select-Object -First 1
$workspacePgDump = Join-Path $projectRoot "work\postgresql18-tools\bin\pg_dump.exe"
$pgDump = if (Test-Path -LiteralPath $workspacePgDump -PathType Leaf) {
  $workspacePgDump
} else {
  Join-Path $versionDirectory.FullName "bin\pg_dump.exe"
}
$psql = Join-Path $versionDirectory.FullName "bin\psql.exe"
$sourcePsql = Join-Path (Split-Path -Parent $pgDump) "psql.exe"
$source = Convert-PostgresUrl $sourceUrl
$target = Convert-PostgresUrl $targetUrl
New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
$dumpPath = Join-Path $workDirectory ("neon-delta-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".sql")

$oldPassword = $env:PGPASSWORD
$oldSslMode = $env:PGSSLMODE
try {
  $env:PGPASSWORD = $source.Password
  $env:PGSSLMODE = "require"
  & $pgDump -h $source.Host -p $source.Port -U $source.User -d $source.Database --data-only --column-inserts --on-conflict-do-nothing --exclude-schema=neon_auth --no-owner --no-privileges --file $dumpPath
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath $dumpPath) { Remove-Item -LiteralPath $dumpPath -Force }
    throw "Neon export failed. Review the pg_dump error above (quota, connectivity, or client compatibility)."
  }

  # A user can already exist locally under a different UUID. Rewrite every
  # reference from the Neon account UUID to the canonical local account UUID
  # before importing dependent rows.
  $env:PGPASSWORD = $source.Password
  $env:PGSSLMODE = "require"
  $sourceAccountRows = @(& $sourcePsql -X -A -t -F "`t" -h $source.Host -p $source.Port -U $source.User -d $source.Database -c "SELECT id, osu_user_id FROM public.accounts")
  if ($LASTEXITCODE -ne 0) { throw "Could not read the Neon account identity map." }

  $env:PGPASSWORD = $target.Password
  $env:PGSSLMODE = "disable"
  $targetAccountRows = @(& $psql -X -A -t -F "`t" -h $target.Host -p $target.Port -U $target.User -d $target.Database -c "SELECT id, osu_user_id FROM public.accounts")
  if ($LASTEXITCODE -ne 0) { throw "Could not read the local account identity map." }

  $localIdByOsuUserId = @{}
  foreach ($row in $targetAccountRows) {
    $parts = $row -split "`t", 2
    if ($parts.Count -eq 2) { $localIdByOsuUserId[$parts[1]] = $parts[0] }
  }

  $dumpText = [IO.File]::ReadAllText($dumpPath)
  $remappedAccounts = 0
  foreach ($row in $sourceAccountRows) {
    $parts = $row -split "`t", 2
    if ($parts.Count -ne 2) { continue }
    $sourceAccountId = $parts[0]
    $osuUserId = $parts[1]
    $localAccountId = $localIdByOsuUserId[$osuUserId]
    if ($localAccountId -and $localAccountId -ne $sourceAccountId) {
      $dumpText = $dumpText.Replace($sourceAccountId, $localAccountId)
      $remappedAccounts++
    }
  }
  [IO.File]::WriteAllText($dumpPath, $dumpText, [Text.UTF8Encoding]::new($false))
  Write-Output "Remapped $remappedAccounts Neon account identities to existing local accounts."

  $env:PGPASSWORD = $target.Password
  $env:PGSSLMODE = "disable"
  & $psql -X -v ON_ERROR_STOP=1 --single-transaction -h $target.Host -p $target.Port -U $target.User -d $target.Database -f $dumpPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Local delta import failed. The SQL dump remains at $dumpPath" }

  Remove-Item -LiteralPath $dumpPath -Force
  Write-Output "Neon-only rows were merged into local PostgreSQL. Existing rows were preserved."
} finally {
  $env:PGPASSWORD = $oldPassword
  $env:PGSSLMODE = $oldSslMode
}
