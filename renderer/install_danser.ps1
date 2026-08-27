[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$rendererRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$destination = [System.IO.Path]::GetFullPath((Join-Path $rendererRoot "local\danser"))
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $rendererRoot "local"))

if (-not $destination.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe danser destination: $destination"
}
if (Test-Path -LiteralPath $destination) {
    throw "danser is already installed at $destination"
}

$headers = @{ "User-Agent" = "osu-pulse-danser-installer" }
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/Wieku/danser-go/releases/latest" -Headers $headers
if ($release.prerelease -or $release.draft) {
    throw "GitHub latest release is not a stable release"
}
$asset = $release.assets | Where-Object { $_.name -match '^danser-[0-9.]+-win\.zip$' } | Select-Object -First 1
if (-not $asset) {
    throw "The official Windows danser archive was not found"
}

$downloadRoot = [System.IO.Path]::GetFullPath((Join-Path $rendererRoot "local\downloads"))
New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
$archive = [System.IO.Path]::GetFullPath((Join-Path $downloadRoot $asset.name))
if (-not $archive.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe archive destination: $archive"
}

Write-Host "[danser] Downloading official $($release.tag_name) release..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archive -Headers $headers
$actualSize = (Get-Item -LiteralPath $archive).Length
if ($actualSize -ne [long]$asset.size) {
    throw "Downloaded size mismatch (expected $($asset.size), got $actualSize)"
}

New-Item -ItemType Directory -Path $destination | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $destination
$executable = Get-ChildItem -LiteralPath $destination -Filter "danser-cli.exe" -File -Recurse | Select-Object -First 1
if (-not $executable) {
    throw "danser-cli.exe was not present in the official archive"
}
if ($executable.DirectoryName -ne $destination) {
    throw "Unexpected archive layout: danser-cli.exe is nested"
}

$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$signature = Get-AuthenticodeSignature -LiteralPath $executable.FullName
Write-Host "[danser] Installed: $($executable.FullName)"
Write-Host "[danser] Release:   $($release.tag_name)"
Write-Host "[danser] SHA-256:   $hash"
Write-Host "[danser] Signature: $($signature.Status)"
