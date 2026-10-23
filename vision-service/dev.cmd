@echo off
REM Sets up and starts Fashion Mode's vision microservice on Windows, to try it locally before
REM deploying. Creates the venv the first time (reuses it afterwards), always installs/updates the
REM dependencies (pip skips what is already up to date) and starts uvicorn with --reload. The first
REM run downloads the model (~300-400MB) from Hugging Face; after that it is cached locally.
setlocal
cd /d "%~dp0"

if not exist .venv (
  echo Creating the virtual environment...
  python -m venv .venv
  if errorlevel 1 goto :error
)

call .venv\Scripts\activate.bat
if errorlevel 1 goto :error

echo Installing/updating dependencies...
pip install -r requirements.txt
if errorlevel 1 goto :error

echo.
echo Starting on http://127.0.0.1:8008 (Ctrl+C to stop)...
echo Try it from another terminal with: curl http://127.0.0.1:8008/health
echo.
uvicorn app:app --host 127.0.0.1 --port 8008 --reload
endlocal
goto :eof

:error
echo.
echo Something failed above. Check the error.
endlocal
exit /b 1
