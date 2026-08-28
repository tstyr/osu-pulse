@echo off
setlocal
title osu! Local Rendering Server

cd /d "%~dp0.."
set "RENDERER_VENV=%~dp0.venv"
set "RENDERER_EXIT_CODE=0"

powershell -NoProfile -Command "$listener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue; if ($listener) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 (
    echo [INFO] Renderer is already running on 127.0.0.1:8765.
    if /i "%~1"=="--check" goto :finished
    goto :stopped
)

where py >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python launcher ^(py.exe^) was not found.
    echo Install Python 3.10 or newer, then run this file again.
    goto :failed
)

if not exist "%RENDERER_VENV%\Scripts\python.exe" (
    if /i "%~1"=="--check" (
        echo [ERROR] Renderer Python environment is not installed.
        goto :failed
    )
    echo [SETUP] Creating renderer Python environment...
    py -3.10 -m venv "%RENDERER_VENV%"
    if errorlevel 1 py -3 -m venv "%RENDERER_VENV%"
    if errorlevel 1 (
        echo [ERROR] Could not create the Python environment.
        goto :failed
    )
)

"%RENDERER_VENV%\Scripts\python.exe" -c "import fastapi,httpx,dotenv,multipart,psutil,uvicorn" >nul 2>nul
if errorlevel 1 (
    if /i "%~1"=="--check" (
        echo [ERROR] Renderer Python dependencies are not installed.
        goto :failed
    )
    echo [SETUP] Installing renderer dependencies...
    "%RENDERER_VENV%\Scripts\python.exe" -m pip install --disable-pip-version-check -r "%~dp0requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Renderer dependencies could not be installed.
        goto :failed
    )
)

"%RENDERER_VENV%\Scripts\python.exe" -c "from renderer.config import settings; raise SystemExit(0 if settings.danser_path and settings.danser_path.is_file() else 1)" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Renderer configuration is invalid or danser-cli.exe was not found.
    echo Check renderer\.env and the DANSER_PATH setting.
    goto :failed
)

if /i "%~1"=="--check" (
    echo [OK] Renderer prerequisites are ready.
    goto :finished
)

set "PYTHONUTF8=1"
"%RENDERER_VENV%\Scripts\python.exe" -m renderer.server
set "RENDERER_EXIT_CODE=%ERRORLEVEL%"
goto :stopped

:failed
set "RENDERER_EXIT_CODE=1"
if /i "%~1"=="--check" goto :finished

:stopped
echo.
echo Renderer stopped.
pause

:finished
endlocal & exit /b %RENDERER_EXIT_CODE%
