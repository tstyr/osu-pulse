@echo off
setlocal
title osu! Pulse Launcher

cd /d "%~dp0"

if /i "%~1"=="--check" goto :check

echo ==============================================
echo               osu! Pulse Launcher
echo ==============================================
echo.
echo Starting Renderer, Lavalink, and Discord Bot in separate windows...
echo.

start "osu! Pulse Renderer" "%ComSpec%" /d /c call "%~dp0renderer\start_renderer.bat"
timeout /t 1 /nobreak >nul
start "osu! Pulse Lavalink" "%ComSpec%" /d /c call "%~dp0lavalink\start_lavalink.bat"

echo Waiting for Lavalink on 127.0.0.1:2333...
powershell -NoProfile -Command "$deadline = [DateTime]::UtcNow.AddSeconds(120); while ([DateTime]::UtcNow -lt $deadline) { if (Get-NetTCPConnection -LocalPort 2333 -State Listen -ErrorAction SilentlyContinue) { exit 0 }; Start-Sleep -Seconds 1 }; exit 1" >nul 2>nul
if errorlevel 1 (
    echo [WARN] Lavalink did not become ready within 120 seconds. The Bot will still start.
) else (
    echo [OK] Lavalink is accepting connections.
)

start "osu! Pulse Discord Bot" "%ComSpec%" /d /c call "%~dp0bot\start_bot.bat"

echo [OK] Startup commands were sent.
echo - Renderer window: Web and Discord replay rendering
echo - Lavalink window: Discord music playback
echo - Bot window: Discord Gateway worker
echo.
echo Each service can be stopped independently with Ctrl+C or by closing its window.
goto :done

:check
set "CHECK_FAILED=0"

if not exist "%~dp0renderer\start_renderer.bat" (
    echo [ERROR] renderer\start_renderer.bat is missing.
    set "CHECK_FAILED=1"
) else (
    echo [OK] Renderer launcher found.
    call "%~dp0renderer\start_renderer.bat" --check
    if errorlevel 1 set "CHECK_FAILED=1"
)

if not exist "%~dp0bot\start_bot.bat" (
    echo [ERROR] bot\start_bot.bat is missing.
    set "CHECK_FAILED=1"
) else (
    echo [OK] Bot launcher found.
    call "%~dp0bot\start_bot.bat" --check
    if errorlevel 1 set "CHECK_FAILED=1"
)

if not exist "%~dp0lavalink\start_lavalink.bat" (
    echo [ERROR] lavalink\start_lavalink.bat is missing.
    set "CHECK_FAILED=1"
) else (
    echo [OK] Lavalink launcher found.
    call "%~dp0lavalink\start_lavalink.bat" --check
    if errorlevel 1 set "CHECK_FAILED=1"
)

if "%CHECK_FAILED%"=="1" (
    echo [ERROR] One or more launcher prerequisites are missing.
    exit /b 1
)
echo [OK] Launcher prerequisites are ready.
exit /b 0

:done
endlocal
