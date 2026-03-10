@echo off
chcp 65001 >nul
cls

set "ROOT_DIR=%~dp0.."
set "PYTHON_EXE=%ROOT_DIR%\.venv\Scripts\python.exe"
set "BACKEND_MAIN=%ROOT_DIR%\backend\main.py"
set "CONFIG_FILE=%~dp0config.yml"
set "ENV_FILE=%~dp0.env"

echo ==========================================
echo   PARAR E SINCRONIZAR DB_BLITZ
echo ==========================================
echo.
echo Parando processos de sincronizacao ativos...

REM Parar processos Python relacionados à sincronização
taskkill /f /im python.exe 2>nul
taskkill /f /im sync_backend_cli.exe 2>nul

echo Aguardando 3 segundos...
timeout /t 3 /nobreak >nul

if not exist "%PYTHON_EXE%" (
    echo ERRO: Python do projeto nao encontrado em "%PYTHON_EXE%"
    echo.
    pause
    exit /b 1
)

echo.
echo Aplicando migrations necessarias...
"%PYTHON_EXE%" "%BACKEND_MAIN%" bootstrap --config "%CONFIG_FILE%" --env-file "%ENV_FILE%"
if errorlevel 1 (
    echo ERRO: Falha ao aplicar migrations do DB_BLITZ
    echo.
    pause
    exit /b 1
)

echo.
echo Executando sincronizacao das tabelas DB_BLITZ...
"%PYTHON_EXE%" "%BACKEND_MAIN%" sync --config "%CONFIG_FILE%" --env-file "%ENV_FILE%" --table db_conf_blitz --force-table db_conf_blitz
if errorlevel 1 (
    echo ERRO: Falha ao sincronizar db_conf_blitz
    echo.
    pause
    exit /b 1
)
"%PYTHON_EXE%" "%BACKEND_MAIN%" sync --config "%CONFIG_FILE%" --env-file "%ENV_FILE%" --table db_div_blitz --force-table db_div_blitz
if errorlevel 1 (
    echo ERRO: Falha ao sincronizar db_div_blitz
    echo.
    pause
    exit /b 1
)

echo.
echo Sincronizacao concluida!
echo.
pause
