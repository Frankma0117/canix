@echo off
REM Creates the SQLite file and applies every migration (Node 20).
setlocal
set "PATH=C:\Users\Asus\node20;%PATH%"
cd /d "%~dp0..\.."
call npm run db:migrate
endlocal
