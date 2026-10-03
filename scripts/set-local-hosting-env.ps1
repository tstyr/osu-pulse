$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Set-DotEnvValue([string]$Path, [string]$Name, [string]$Value) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        [IO.File]::WriteAllText($Path, "$Name=$Value`r`n", [Text.UTF8Encoding]::new($false))
        return
    }
    $lines = [Collections.Generic.List[string]]::new()
    foreach ($line in [IO.File]::ReadAllLines($Path)) { [void]$lines.Add($line) }
    $replacement = "$Name=$Value"
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

Set-DotEnvValue (Join-Path $projectRoot ".env.local") "WEB_APP_URL" "http://127.0.0.1:3000"
Set-DotEnvValue (Join-Path $projectRoot ".env.local") "OSU_PULSE_PUBLIC_URL_FILE" "work/public-web-url.txt"
Set-DotEnvValue (Join-Path $projectRoot ".env.local") "LAVALINK_HOST" "127.0.0.1"
Set-DotEnvValue (Join-Path $projectRoot "renderer\.env") "RENDER_CLOUD_URL" "http://127.0.0.1:3000"

Write-Output "[OK] Web UI and Renderer bridge now use the local Node.js server."
