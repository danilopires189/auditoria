@echo off
chcp 65001 >nul
cls

set "ROOT_DIR=%~dp0.."
set "PYTHON_EXE=%ROOT_DIR%\.venv\Scripts\python.exe"
set "BACKEND_MAIN=%ROOT_DIR%\backend\main.py"
set "CONFIG_FILE=%~dp0config.yml"
set "ENV_FILE=%~dp0.env"

echo ==========================================
echo   FORCAR SINCRONIZACAO DB_BLITZ
echo ==========================================
echo.
echo Este script vai forcar a criacao das tabelas DB_BLITZ
echo.

if not exist "%PYTHON_EXE%" (
    echo ERRO: Python do projeto nao encontrado em "%PYTHON_EXE%"
    echo.
    pause
    exit /b 1
)

echo Aplicando migrations necessarias...
"%PYTHON_EXE%" "%BACKEND_MAIN%" bootstrap --config "%CONFIG_FILE%" --env-file "%ENV_FILE%"
if errorlevel 1 (
    echo ERRO: Falha ao aplicar migrations do DB_BLITZ
    echo.
    pause
    exit /b 1
)

echo Executando sincronizacao completa do DB_BLITZ...
"%PYTHON_EXE%" "%BACKEND_MAIN%" sync --config "%CONFIG_FILE%" --env-file "%ENV_FILE%" --table db_conf_blitz --table db_div_blitz --force-table db_conf_blitz --force-table db_div_blitz
if errorlevel 1 (
    echo ERRO: Falha na sincronizacao
    echo.
    pause
    exit /b 1
)

echo.
echo Sincronizacao concluida!
echo.
pause
