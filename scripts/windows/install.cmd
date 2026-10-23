@echo off
REM Installs backend + frontend dependencies and builds the frontend, with Node 20
REM (the system's default node is too old and breaks baileys' preinstall check).
setlocal
set "PATH=C:\Users\Asus\node20;%PATH%"
cd /d "%~dp0..\.."
node -v

echo === Backend ===
call npm ci --prefix backend
if errorlevel 1 goto :error

echo === Frontend ===
call npm ci --prefix frontend
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

echo Done. Now run scripts\windows\start.cmd
endlocal
goto :eof

:error
echo Installation failed. Check the error above.
endlocal
exit /b 1
