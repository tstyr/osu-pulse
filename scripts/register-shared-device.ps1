$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$line = [IO.File]::ReadAllLines((Join-Path $projectRoot '.env.local')) | Where-Object { $_ -match '^OSU_PULSE_SHARED_ROOT=' } | Select-Object -Last 1
if (-not $line) { throw 'OSU_PULSE_SHARED_ROOT is not configured.' }
$sharedRoot = (($line -split '=', 2)[1]).Trim().Trim('"').Trim("'")
if (-not (Test-Path -LiteralPath ([IO.Path]::Combine($sharedRoot, 'shared-storage.json')))) { throw 'Mount the shared USB before registering it.' }
$letter = [IO.Path]::GetPathRoot($sharedRoot).Substring(0, 1)
$partition = Get-Partition -DriveLetter $letter -ErrorAction Stop
$disk = Get-Disk -Number $partition.DiskNumber -ErrorAction Stop
if ($disk.BusType -ne 'USB' -or -not $disk.SerialNumber -or -not $disk.SerialNumber.Trim()) { throw 'The configured root is not an identifiable USB disk.' }
$state = [ordered]@{ serialNumber = $disk.SerialNumber.Trim(); diskSize = $disk.Size; partitionSize = $partition.Size; friendlyName = $disk.FriendlyName }
$workPath = Join-Path $projectRoot 'work'
New-Item -ItemType Directory -Path $workPath -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $workPath 'shared-storage-device.json'), ($state | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Output '[OK] Shared USB identity registered locally.'
