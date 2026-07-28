@echo off
REM Arranca canix en modo desarrollo (recarga solo al guardar cambios), usando Node 20.
REM A diferencia de start.cmd, esto SI recarga automatico - usalo mientras estamos
REM probando fixes en local, para no tener que parar/arrancar a mano cada vez.
setlocal
set "PATH=C:\Users\Asus\node20;%PATH%"
cd /d "%~dp0"
echo Usando Node:
node -v
call npm run dev
endlocal
