@echo off
REM Crea el archivo SQLite y las tablas (usa Node 20).
setlocal
set "PATH=C:\Users\Asus\node20;%PATH%"
cd /d "%~dp0"
call npm run db:init
endlocal
