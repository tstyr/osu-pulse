@echo off
setlocal
title osu! Pulse Discord Bot

set "BOT_EXIT_CODE=0"

cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    echo Install Node.js 22 or newer, then run this file again.
    goto :failed
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found.
    echo Reinstall Node.js with npm enabled.
    goto :failed
)

powershell -NoProfile -Command "$running = Get-CimInstance Win32_Process ^| Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'bot[\\/]index\.ts' }; if ($running) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 (
    echo [INFO] Discord Bot is already running.
    if /i "%~1"=="--check" goto :finished
    goto :stopped
)

if not exist ".env.local" (
    echo [ERROR] .env.local was not found.
    echo Copy .env.example to .env.local and configure the Bot first.
    goto :failed
)

if not exist "node_modules\.bin\tsx.cmd" (
    if /i "%~1"=="--check" (
        echo [ERROR] Node.js dependencies are not installed.
        goto :failed
    )
    echo [SETUP] Installing Node.js dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Node.js dependencies could not be installed.
        goto :failed
    )
)

call "node_modules\.bin\dotenv.cmd" -e .env.local -- node -e "if (!process.env.DISCORD_TOKEN || !process.env.DATABASE_URL) process.exit(1)" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] DISCORD_TOKEN or DATABASE_URL is missing in .env.local.
    echo Add the missing values, then run this file again.
    goto :failed
)

if /i "%~1"=="--check" (
    echo [OK] Discord Bot prerequisites are ready.
    goto :finished
)

echo ==============================================
echo              osu! Pulse Discord Bot
echo ==============================================
echo.
echo Starting the local Discord Gateway worker...
echo Close this window or press Ctrl+C to stop only the Bot.
echo.

call npm run bot:start
set "BOT_EXIT_CODE=%ERRORLEVEL%"
goto :stopped

:failed
set "BOT_EXIT_CODE=1"
if /i "%~1"=="--check" goto :finished

:stopped
echo.
echo Bot stopped.
pause

:finished
endlocal & exit /b %BOT_EXIT_CODE%
