@echo off
REM Arranca canix usando Node 20 (el node por defecto del sistema es muy viejo).
setlocal
set "PATH=C:\Users\Asus\node20;%PATH%"
cd /d "%~dp0"
echo Usando Node:
node -v
call npm run start
endlocal
