@echo off
setlocal
chcp 65001 >nul
title osu! Pulse Launcher
cd /d "%~dp0"

set "LAUNCH_MODE="
if /i "%~1"=="--check" set "LAUNCH_MODE=-Check"
if /i "%~1"=="--status" set "LAUNCH_MODE=-Status"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all-local.ps1" %LAUNCH_MODE%
set "LAUNCH_EXIT_CODE=%ERRORLEVEL%"

if /i "%~1"=="--check" goto :done
if /i "%~1"=="--status" goto :done
if /i "%~1"=="--no-pause" goto :done

echo.
if not "%LAUNCH_EXIT_CODE%"=="0" (
    echo Startup failed. Check the message above and the work log directory.
)
pause

:done
endlocal & exit /b %LAUNCH_EXIT_CODE%
