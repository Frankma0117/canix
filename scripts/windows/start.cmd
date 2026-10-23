@echo off
REM Starts Canix with Node 20 (this machine's default node is too old).
setlocal
set "PATH=C:\Users\Asus\node20;%PATH%"
cd /d "%~dp0..\.."
node -v
call npm run start
endlocal
