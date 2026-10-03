@echo off
setlocal
title osu! Pulse Local Web UI
cd /d "%~dp0"

if /i "%~1"=="--check" (
    where node.exe >nul 2>nul || (echo [ERROR] Node.js was not found.& exit /b 1)
    if not exist "node_modules\next\dist\bin\next" (echo [ERROR] Next.js dependencies are missing.& exit /b 1)
    echo [OK] Local Web UI prerequisites are ready.
    exit /b 0
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-web.ps1"
set "WEB_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Local Web UI stopped.
if /i "%~1"=="--no-pause" goto :finished
pause
:finished
endlocal & exit /b %WEB_EXIT_CODE%
