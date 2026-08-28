param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$version = "4.2.2"
$expectedSha256 = "8cb801e591072c3689fafd71ccf571a95a4ead3cc35dfc045e157d763d89119a"
$downloadUrl = "https://github.com/lavalink-devs/Lavalink/releases/download/$version/Lavalink.jar"
$runtimeDirectory = Join-Path $PSScriptRoot "runtime"
$jarPath = Join-Path $runtimeDirectory "Lavalink.jar"
$downloadPath = Join-Path $runtimeDirectory "Lavalink.jar.download"

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha256.ComputeHash($stream)
        return ([System.BitConverter]::ToString($bytes) -replace "-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Test-LavalinkJar {
    if (-not (Test-Path -LiteralPath $jarPath -PathType Leaf)) {
        return $false
    }

    $actualHash = Get-Sha256 $jarPath
    return $actualHash -eq $expectedSha256
}

if (Test-LavalinkJar) {
    Write-Host "[OK] Lavalink $version is installed and verified."
    exit 0
}

if ($CheckOnly) {
    Write-Host "[ERROR] Lavalink $version is not installed or failed checksum verification."
    exit 1
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
if (Test-Path -LiteralPath $downloadPath) {
    Remove-Item -LiteralPath $downloadPath -Force
}

Write-Host "[SETUP] Downloading official Lavalink $version (about 100 MB)..."
try {
    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $downloadPath
    $actualHash = Get-Sha256 $downloadPath
    if ($actualHash -ne $expectedSha256) {
        throw "Lavalink checksum mismatch. Expected $expectedSha256 but received $actualHash."
    }
    Move-Item -LiteralPath $downloadPath -Destination $jarPath -Force
} finally {
    if (Test-Path -LiteralPath $downloadPath) {
        Remove-Item -LiteralPath $downloadPath -Force
    }
}

Write-Host "[OK] Lavalink $version was installed and verified."
