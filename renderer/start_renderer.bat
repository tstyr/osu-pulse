@echo off
setlocal
title osu! Local Rendering Server

cd /d "%~dp0.."
set "RENDERER_VENV=%~dp0.venv"

where py >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python launcher ^(py.exe^) was not found.
    echo Install Python 3.10 or newer, then run this file again.
    goto :stopped
)

if not exist "%RENDERER_VENV%\Scripts\python.exe" (
    echo [SETUP] Creating renderer Python environment...
    py -3.10 -m venv "%RENDERER_VENV%"
    if errorlevel 1 py -3 -m venv "%RENDERER_VENV%"
    if errorlevel 1 (
        echo [ERROR] Could not create the Python environment.
        goto :stopped
    )
)

"%RENDERER_VENV%\Scripts\python.exe" -c "import fastapi,httpx,dotenv,multipart,uvicorn" >nul 2>nul
if errorlevel 1 (
    echo [SETUP] Installing renderer dependencies...
    "%RENDERER_VENV%\Scripts\python.exe" -m pip install --disable-pip-version-check -r "%~dp0requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Renderer dependencies could not be installed.
        goto :stopped
    )
)

set "PYTHONUTF8=1"
"%RENDERER_VENV%\Scripts\python.exe" -m renderer.server

:stopped
echo.
echo Renderer stopped.
pause
endlocal
