@echo off
REM Deja listo y arranca el microservicio de vision de Fashion Mode en Windows, para probarlo en
REM local antes de desplegarlo al servidor. Crea el venv la primera vez (si ya existe, lo reusa),
REM instala/actualiza dependencias siempre (pip no reinstala lo que ya esta al dia), y arranca
REM uvicorn con --reload. La primera vez descarga el modelo (~300-400MB) desde Hugging Face -
REM necesita internet esa vez, despues queda cacheado localmente.
setlocal
cd /d "%~dp0"

if not exist .venv (
  echo Creando entorno virtual...
  python -m venv .venv
  if errorlevel 1 goto :error
)

call .venv\Scripts\activate.bat
if errorlevel 1 goto :error

echo Instalando/actualizando dependencias...
pip install -r requirements.txt
if errorlevel 1 goto :error

echo.
echo Arrancando en http://127.0.0.1:8008 (Ctrl+C para detener)...
echo Probalo en otra terminal con: curl http://127.0.0.1:8008/health
echo.
uvicorn app:app --host 127.0.0.1 --port 8008 --reload
endlocal
goto :eof

:error
echo.
echo Algo fallo arriba. Revisa el error.
endlocal
exit /b 1
