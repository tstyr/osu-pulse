$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"
if (-not (Test-Path -LiteralPath $envPath)) { exit 0 }
$databaseLine = [IO.File]::ReadAllLines($envPath) | Where-Object { $_ -match "^DATABASE_URL=" } | Select-Object -First 1
if (-not $databaseLine -or $databaseLine -notmatch "@(localhost|127\.0\.0\.1|\[::1\])[:/]") { exit 0 }

if (Get-NetTCPConnection -LocalPort 54329 -State Listen -ErrorAction SilentlyContinue) {
  exit 0
}

$postgresRoot = Join-Path $env:ProgramFiles "PostgreSQL"
$version = Get-ChildItem -LiteralPath $postgresRoot -Directory -ErrorAction SilentlyContinue |
  Sort-Object { [int]($_.Name -replace "\D", "") } -Descending |
  Select-Object -First 1
if (-not $version) { throw "Local PostgreSQL is not installed." }

$control = Join-Path $version.FullName "bin\pg_ctl.exe"
$data = Join-Path $version.FullName "data"
$workDirectory = Join-Path $projectRoot "work"
$logPath = Join-Path $workDirectory "postgres.log"
New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
& $control start -D $data -l $logPath -w | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Local PostgreSQL could not be started." }
