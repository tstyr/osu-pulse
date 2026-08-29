@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_autostart.ps1" %*
set "AUTOSTART_EXIT_CODE=%ERRORLEVEL%"
if not "%AUTOSTART_EXIT_CODE%"=="0" pause
endlocal & exit /b %AUTOSTART_EXIT_CODE%
