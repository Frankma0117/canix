@echo off
REM Starts the backend in watch mode (reloads on save) with Node 20.
setlocal
set "PATH=C:\Users\Asus\node20;%PATH%"
cd /d "%~dp0..\.."
node -v
call npm run dev
endlocal
