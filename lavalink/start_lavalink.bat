@echo off
setlocal
title osu! Pulse Lavalink

set "LAVALINK_EXIT_CODE=0"

cd /d "%~dp0.."

powershell -NoProfile -Command "$listener = Get-NetTCPConnection -LocalPort 2333 -State Listen -ErrorAction SilentlyContinue; if ($listener) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 (
    echo [INFO] Lavalink is already running on 127.0.0.1:2333.
    if /i "%~1"=="--check" goto :finished
    goto :stopped
)

where java >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Java was not found.
    echo Install Java 17 or newer, then run this file again.
    goto :failed
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    goto :failed
)

if not exist ".env.local" (
    echo [ERROR] .env.local was not found.
    goto :failed
)

if not exist "node_modules\.bin\dotenv.cmd" (
    echo [ERROR] Node.js dependencies are not installed.
    echo Run npm install, then run this file again.
    goto :failed
)

call "node_modules\.bin\dotenv.cmd" -e .env.local -- node -e "if (!process.env.LAVALINK_PASSWORD) process.exit(1)" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] LAVALINK_PASSWORD is missing in .env.local.
    goto :failed
)

if /i "%~1"=="--check" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_lavalink.ps1" -CheckOnly
    if errorlevel 1 goto :failed
    echo [OK] Lavalink prerequisites are ready.
    goto :finished
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_lavalink.ps1"
if errorlevel 1 (
    echo [ERROR] Lavalink could not be installed.
    goto :failed
)

echo ==============================================
echo                osu! Pulse Lavalink
echo ==============================================
echo.
echo Starting the local music node on 127.0.0.1:2333...
echo Close this window or press Ctrl+C to stop only Lavalink.
echo.

call "node_modules\.bin\dotenv.cmd" -e .env.local -- node lavalink\run-local.mjs
set "LAVALINK_EXIT_CODE=%ERRORLEVEL%"
goto :stopped

:failed
set "LAVALINK_EXIT_CODE=1"
if /i "%~1"=="--check" goto :finished

:stopped
echo.
echo Lavalink stopped.
pause

:finished
endlocal & exit /b %LAVALINK_EXIT_CODE%
