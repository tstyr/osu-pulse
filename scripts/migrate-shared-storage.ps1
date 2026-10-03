param(
    [string]$SharedRoot = "F:\osu-pulse-shared",
    [switch]$SkipSongs,
    [switch]$SkipSkins,
    [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$rootEnv = Join-Path $projectRoot ".env.local"
$rendererEnv = Join-Path $projectRoot "renderer\.env"

function Set-DotEnvValue([string]$Path, [string]$Name, [string]$Value) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $lines = [Collections.Generic.List[string]]::new()
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        foreach ($line in [IO.File]::ReadAllLines($Path)) { [void]$lines.Add($line) }
    }
    $escaped = $Value.Replace("'", "\'")
    $replacement = "$Name='$escaped'"
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match "^$([regex]::Escape($Name))=") {
            $lines[$index] = $replacement
            $found = $true
            break
        }
    }
    if (-not $found) { [void]$lines.Add($replacement) }
    [IO.File]::WriteAllLines($Path, $lines, [Text.UTF8Encoding]::new($false))
}

function Copy-SharedTree([string]$Source, [string]$Destination, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        Write-Host "[SKIP] $Label source does not exist: $Source"
        return
    }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Write-Host "[COPY] $Label"
    Write-Host "       $Source"
    Write-Host "    -> $Destination"
    & robocopy $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /FFT /XJ /MT:8 /NP /NFL /NDL
    $code = $LASTEXITCODE
    if ($code -gt 7) { throw "robocopy failed for $Label with exit code $code" }
}

$sharedPath = [IO.Path]::GetFullPath($SharedRoot)
$driveRoot = [IO.Path]::GetPathRoot($sharedPath)
if (-not $driveRoot -or -not (Test-Path -LiteralPath $driveRoot -PathType Container)) {
    throw "Shared drive is not mounted: $driveRoot"
}
$driveLetter = $driveRoot.Substring(0, 1)
$volume = Get-Volume -DriveLetter $driveLetter -ErrorAction Stop
if ($volume.FileSystem -ne "exFAT") {
    throw "Shared drive must be exFAT. Current filesystem: $($volume.FileSystem)"
}
if ($volume.SizeRemaining -lt 10GB) {
    throw "At least 10 GiB of free space is required before migration."
}

New-Item -ItemType Directory -Path $sharedPath -Force | Out-Null
$audioPath = Join-Path $sharedPath "audio"
$songsPath = Join-Path $sharedPath "osu\Songs"
$skinsPath = Join-Path $sharedPath "osu\Skins"
$outputPath = Join-Path $sharedPath "renders\output"
$backupPath = Join-Path $sharedPath "backups"
$platformPath = Join-Path $sharedPath "platform"
foreach ($path in @($audioPath, $songsPath, $skinsPath, $outputPath, $backupPath, $platformPath)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
}

Copy-SharedTree (Join-Path $projectRoot "bot-audio") $audioPath "Bot audio"
Copy-SharedTree (Join-Path $projectRoot "renderer\output") $outputPath "Rendered videos"
if (-not $SkipSongs) {
    Copy-SharedTree (Join-Path $env:LOCALAPPDATA "osu!\Songs") $songsPath "osu! Songs"
}
if (-not $SkipSkins) {
    Copy-SharedTree (Join-Path $env:LOCALAPPDATA "osu!\Skins") $skinsPath "osu! Skins"
}

Set-DotEnvValue $rootEnv "OSU_PULSE_SHARED_ROOT" $sharedPath
Set-DotEnvValue $rootEnv "BOT_AUDIO_DIR" $audioPath
Set-DotEnvValue $rendererEnv "OSU_PULSE_SHARED_ROOT" $sharedPath
Set-DotEnvValue $rendererEnv "OSU_SONGS_PATH" $songsPath
Set-DotEnvValue $rendererEnv "OSU_SKINS_PATH" $skinsPath
Set-DotEnvValue $rendererEnv "OUTPUT_PATH" $outputPath

$manifest = [ordered]@{
    version = 1
    updatedAt = [DateTime]::UtcNow.ToString("o")
    filesystem = $volume.FileSystem
    windowsRoot = $sharedPath
    archRoot = "/mnt/osu-pulse/osu-pulse-shared"
    directories = [ordered]@{
        audio = "audio"
        songs = "osu/Songs"
        skins = "osu/Skins"
        renders = "renders/output"
        backups = "backups"
    }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $sharedPath "shared-storage.json") -Encoding UTF8
$envSnapshot = [ordered]@{
    platform = "windows"
    configuredAt = [DateTime]::UtcNow.ToString("o")
    computerName = $env:COMPUTERNAME
    projectRoot = $projectRoot
}
$envSnapshot | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $platformPath "windows.json") -Encoding UTF8
& (Join-Path $PSScriptRoot 'register-shared-device.ps1')

try {
    if (-not $volume.FileSystemLabel) { Set-Volume -DriveLetter $driveLetter -NewFileSystemLabel "OSU_PULSE" -ErrorAction Stop }
} catch {
    Write-Warning "Could not set the optional OSU_PULSE volume label: $($_.Exception.Message)"
}

if (-not $SkipRestart) {
    foreach ($service in @("bot", "renderer")) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\restart-local-service.ps1") -Service $service
        if ($LASTEXITCODE -ne 0) { throw "Failed to restart $service" }
    }
}

Write-Host ""
Write-Host "[OK] Shared storage migration completed."
Write-Host "Shared root : $sharedPath"
Write-Host "Rollback     : original files were kept in place"
Write-Host "Arch mount  : /mnt/osu-pulse/osu-pulse-shared"
