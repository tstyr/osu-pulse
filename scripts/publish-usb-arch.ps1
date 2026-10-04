param([string]$UsbRoot = 'F:\')
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$usbPath = [IO.Path]::GetFullPath($UsbRoot)
if (-not (Test-Path -LiteralPath (Join-Path $usbPath 'osu-pulse-shared\shared-storage.json'))) { throw 'Verified osu! Pulse shared storage was not found.' }
$destination = Join-Path $usbPath 'osu-pulse-arch'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
# Copy only the portable application. Keep Windows native dependencies,
# transient state, media and live database files out of the Arch package.
& robocopy $projectRoot $destination /E /FFT /R:1 /W:1 /NP /NFL /NDL /XD .git node_modules .next .vercel work bot-audio .venv .venv-mania __pycache__ .pytest_cache downloads output temp logs /XF '*.pyc' '*.tsbuildinfo' '*.exe' '*.dll' '*.db' 'beatmap-index.json' 'stats.json' 'youtube-pending.json'
if ($LASTEXITCODE -gt 7) { throw "USB application copy failed: $LASTEXITCODE" }
# Project identifiers are portable; CLI authentication is deliberately not.
$vercelProjectPath = Join-Path $projectRoot '.vercel\project.json'
if (Test-Path -LiteralPath $vercelProjectPath) {
    $sharedPlatform = Join-Path $usbPath 'osu-pulse-shared\platform'
    New-Item -ItemType Directory -Path $sharedPlatform -Force | Out-Null
    Copy-Item -LiteralPath $vercelProjectPath -Destination (Join-Path $sharedPlatform 'vercel-project.json') -Force
}
# Shell scripts must have Unix line endings, including files edited on Windows.
foreach ($script in (Get-ChildItem -LiteralPath $destination -Filter '*.sh' -Recurse -File)) {
    $normalized = [IO.File]::ReadAllText($script.FullName).Replace("`r`n", "`n")
    [IO.File]::WriteAllText($script.FullName, $normalized, [Text.UTF8Encoding]::new($false))
}
$launcher = Join-Path $usbPath 'START_OSU_PULSE_ARCH.sh'
$text = [IO.File]::ReadAllText((Join-Path $projectRoot 'START_OSU_PULSE_ARCH.sh')).Replace("`r`n", "`n")
[IO.File]::WriteAllText($launcher, $text, [Text.UTF8Encoding]::new($false))
$desktopText = (& node (Join-Path $PSScriptRoot 'arch-desktop-entry.mjs') usb) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Could not generate the Arch desktop launcher.' }
[IO.File]::WriteAllText((Join-Path $usbPath 'START_OSU_PULSE_ARCH.desktop'), $desktopText + "`n", [Text.UTF8Encoding]::new($false))
$readmeText = [IO.File]::ReadAllText((Join-Path $projectRoot 'README_ARCH.txt')).Replace("`r`n", "`n")
[IO.File]::WriteAllText((Join-Path $usbPath 'README_ARCH.txt'), $readmeText, [Text.UTF8Encoding]::new($false))
Write-Output "[OK] USB Arch package updated: $destination"
Write-Output "[OK] USB launcher: $launcher"
Write-Output "[OK] Terminal shortcut: $(Join-Path $usbPath 'START_OSU_PULSE_ARCH.desktop')"
