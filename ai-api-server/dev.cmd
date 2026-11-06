@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Python virtual environment was not found.
    echo Run: py -3.15 -m venv .venv
    echo Then: .venv\Scripts\python.exe -m pip install -r requirements.txt
    exit /b 1
)

".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir "%~dp0app" %*
exit /b %errorlevel%
