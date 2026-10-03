$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectRoot '.env.local'
$line = [IO.File]::ReadAllLines($envPath) | Where-Object { $_ -match '^OSU_PULSE_SHARED_ROOT=' } | Select-Object -Last 1
if (-not $line) { exit 0 }
$sharedRoot = (($line -split '=', 2)[1]).Trim().Trim('"').Trim("'")
$identityPath = Join-Path $projectRoot 'work\shared-storage-device.json'
$manifestPath = [IO.Path]::Combine($sharedRoot, 'shared-storage.json')
if (Test-Path -LiteralPath $manifestPath) {
    if (-not (Test-Path -LiteralPath $identityPath)) { & (Join-Path $PSScriptRoot 'register-shared-device.ps1') }
    exit 0
}
$driveRoot = [IO.Path]::GetPathRoot($sharedRoot)
if ($driveRoot -notmatch '^[A-Z]:\\$') { throw 'Shared storage must use an absolute Windows drive path.' }
$letter = $driveRoot.Substring(0, 1)
if (Test-Path -LiteralPath $driveRoot) { throw "$driveRoot is occupied by a different or incomplete volume." }
if (-not (Test-Path -LiteralPath $identityPath)) { throw 'USB identity is not registered. Mount it once and run scripts/register-shared-device.ps1.' }
$identity = [IO.File]::ReadAllText($identityPath) | ConvertFrom-Json
# Match the registered USB by hardware identity, never disk number.
$disk = Get-Disk | Where-Object {
    $_.BusType -eq 'USB' -and $_.SerialNumber -and $_.SerialNumber.Trim() -eq $identity.serialNumber -and
    $_.FriendlyName -eq $identity.friendlyName -and $_.Size -eq $identity.diskSize
}
if (@($disk).Count -ne 1) { throw 'The registered OSU_PULSE USB is not connected.' }
$partition = Get-Partition -DiskNumber $disk.Number | Where-Object { $_.Size -eq $identity.partitionSize -and $_.Type -ne 'XINT13 Extended' }
if (@($partition).Count -ne 1) { throw 'The registered shared partition was not found.' }
if ($partition.DriveLetter -and [int][char]$partition.DriveLetter -ne 0) { throw "The shared USB already uses $($partition.DriveLetter):; inspect its configured path." }
Set-Partition -DiskNumber $disk.Number -PartitionNumber $partition.PartitionNumber -NewDriveLetter $letter
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'USB was mounted but its shared-storage manifest is missing.' }
Write-Output "[OK] Restored shared storage at $driveRoot"
