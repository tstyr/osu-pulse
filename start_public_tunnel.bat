@echo off
setlocal
title osu! Pulse Cloudflare Tunnel
cd /d "%~dp0"

if /i "%~1"=="--check" (
    where cloudflared.exe >nul 2>nul || (echo [ERROR] cloudflared was not found.& exit /b 1)
    echo [OK] Cloudflare Tunnel prerequisites are ready.
    exit /b 0
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-public-tunnel.ps1"
set "TUNNEL_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Cloudflare Tunnel stopped.
if /i "%~1"=="--no-pause" goto :finished
pause
:finished
endlocal & exit /b %TUNNEL_EXIT_CODE%
