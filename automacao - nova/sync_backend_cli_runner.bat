@echo off
setlocal EnableExtensions

set "BASE_DIR=%~dp0"
set "LOCAL_EXE=%BASE_DIR%sync_backend_cli.exe"
set "BACKEND_MAIN=%BASE_DIR%..\backend\main.py"
set "PYTHON_EXE="

if exist "%BASE_DIR%..\.venv\Scripts\python.exe" set "PYTHON_EXE=%BASE_DIR%..\.venv\Scripts\python.exe"
if not defined PYTHON_EXE if exist "%BASE_DIR%.venv\Scripts\python.exe" set "PYTHON_EXE=%BASE_DIR%.venv\Scripts\python.exe"

if defined PYTHON_EXE if exist "%BACKEND_MAIN%" (
    "%PYTHON_EXE%" "%BACKEND_MAIN%" %* --config "%BASE_DIR%config.yml" --env-file "%BASE_DIR%.env"
    exit /b %errorlevel%
)

if exist "%LOCAL_EXE%" (
    "%LOCAL_EXE%" %* --config "%BASE_DIR%config.yml" --env-file "%BASE_DIR%.env"
    exit /b %errorlevel%
)

echo ERRO: Nenhum backend de sincronizacao foi encontrado.
echo Esperado:
echo   - "%BACKEND_MAIN%"
echo   - ou "%LOCAL_EXE%"
exit /b 1
