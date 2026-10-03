param(
  [int]$Port = 54329,
  [string]$Database = "osu_pulse"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $projectRoot "work\local-postgres.secret"
$envPath = Join-Path $projectRoot ".env.local"
$postgresRoot = Join-Path $env:ProgramFiles "PostgreSQL"

if (-not (Test-Path -LiteralPath $secretPath)) {
  throw "Local PostgreSQL password file is missing: $secretPath"
}
if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env.local is missing: $envPath"
}

$versionDirectory = Get-ChildItem -LiteralPath $postgresRoot -Directory -ErrorAction Stop |
  Sort-Object { [int]($_.Name -replace "\D", "") } -Descending |
  Select-Object -First 1
if (-not $versionDirectory) {
  throw "PostgreSQL installation was not found under $postgresRoot"
}

$psql = Join-Path $versionDirectory.FullName "bin\psql.exe"
$createdb = Join-Path $versionDirectory.FullName "bin\createdb.exe"
if (-not (Test-Path -LiteralPath $psql) -or -not (Test-Path -LiteralPath $createdb)) {
  throw "PostgreSQL command line tools are missing."
}

$password = (Get-Content -LiteralPath $secretPath -Raw).Trim()
if (-not $password) {
  throw "Local PostgreSQL password file is empty."
}

$oldPgPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $password
  $databaseExists = & $psql -X -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc "select 1 from pg_database where datname = '$Database'"
  if ($LASTEXITCODE -ne 0) { throw "Could not connect to local PostgreSQL." }

  # Replace the installer password before it is written into application config.
  # SQL is delivered through stdin so the new secret never appears in a process command line.
  $randomBytes = New-Object byte[] 32
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
  $rotatedPassword = [Convert]::ToBase64String($randomBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  "alter role postgres with password '$rotatedPassword';" | & $psql -X -h 127.0.0.1 -p $Port -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw "Could not rotate the local PostgreSQL password." }
  $password = $rotatedPassword
  $env:PGPASSWORD = $password
  [IO.File]::WriteAllText($secretPath, $password, [Text.UTF8Encoding]::new($false))

  if (($databaseExists | Out-String).Trim() -ne "1") {
    & $createdb -h 127.0.0.1 -p $Port -U postgres --encoding UTF8 $Database
    if ($LASTEXITCODE -ne 0) { throw "Could not create local database $Database." }
  }
} finally {
  $env:PGPASSWORD = $oldPgPassword
}

$content = [IO.File]::ReadAllText($envPath)
$lineEnding = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = [Collections.Generic.List[string]]::new()
foreach ($line in ($content -split "\r?\n")) { [void]$lines.Add($line) }

function Get-EnvValue([string]$Name) {
  foreach ($line in $lines) {
    if ($line -match ("^" + [regex]::Escape($Name) + "=(.*)$")) { return $Matches[1] }
  }
  return $null
}

function Set-EnvValue([string]$Name, [string]$Value) {
  for ($index = 0; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index] -match ("^" + [regex]::Escape($Name) + "=")) {
      $lines[$index] = "$Name=$Value"
      return
    }
  }
  if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -ne "") { [void]$lines.Add("") }
  [void]$lines.Add("$Name=$Value")
}

$currentDatabaseUrl = Get-EnvValue "DATABASE_URL"
$savedNeonUrl = Get-EnvValue "NEON_DATABASE_URL"
if (-not $savedNeonUrl -and $currentDatabaseUrl -and $currentDatabaseUrl -notmatch "@(localhost|127\.0\.0\.1|\[::1\])[:/]") {
  Set-EnvValue "NEON_DATABASE_URL" $currentDatabaseUrl
}

$encodedPassword = [Uri]::EscapeDataString($password)
Set-EnvValue "DATABASE_URL" "postgresql://postgres:$encodedPassword@127.0.0.1:$Port/$Database"
Set-EnvValue "LOCAL_DATABASE_POOL_SIZE" "5"

$normalized = ($lines -join $lineEnding).TrimEnd("`r", "`n") + $lineEnding
[IO.File]::WriteAllText($envPath, $normalized, [Text.UTF8Encoding]::new($false))

Write-Output "Local PostgreSQL is configured on 127.0.0.1:$Port/$Database."
Write-Output "The previous Neon URL is preserved as NEON_DATABASE_URL when available."
