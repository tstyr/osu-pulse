@echo off
cd /d "%~dp0"
call "%~dp0start_osu_pulse.bat" %*
exit /b %ERRORLEVEL%
