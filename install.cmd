@echo off
REM Instala dependencias de canix (backend + panel admin) usando Node 20
REM (el node por defecto del sistema es muy viejo y hace fallar el preinstall de baileys).
setlocal
set "PATH=C:\Users\Asus\node20;%PATH%"
cd /d "%~dp0"
echo Usando Node:
node -v
echo.
echo === Backend ===
call npm install
if errorlevel 1 goto :error

echo.
echo === Panel admin ===
cd admin-panel
call npm install
if errorlevel 1 goto :error
call npm run build
cd ..

echo.
echo Listo. Ahora puedes correr start.cmd
endlocal
goto :eof

:error
echo.
echo La instalacion fallo. Revisa el error de arriba.
endlocal
exit /b 1
