@echo off
chcp 65001 >nul
cls

set "ROOT_DIR=%~dp0.."
set "PYTHON_EXE=%ROOT_DIR%\.venv\Scripts\python.exe"
set "BACKEND_MAIN=%ROOT_DIR%\backend\main.py"
set "CONFIG_FILE=%~dp0config.yml"
set "ENV_FILE=%~dp0.env"

echo ==========================================
echo   REINICIAR SISTEMA PARA DB_BLITZ
echo ==========================================
echo.
echo Parando TODOS os processos relacionados...

REM Parar processos mais agressivamente
taskkill /f /im python.exe 2>nul
taskkill /f /im sync_backend_cli.exe 2>nul
taskkill /f /im wscript.exe 2>nul
taskkill /f /im cscript.exe 2>nul

echo Aguardando 5 segundos para garantir que tudo parou...
timeout /t 5 /nobreak >nul

if not exist "%PYTHON_EXE%" (
    echo ERRO: Python do projeto nao encontrado em "%PYTHON_EXE%"
    echo.
    pause
    exit /b 1
)

echo.
echo Executando sincronizacao completa do DB_BLITZ...
"%PYTHON_EXE%" "%BACKEND_MAIN%" sync --config "%CONFIG_FILE%" --env-file "%ENV_FILE%" --table db_conf_blitz --table db_div_blitz --force-table db_conf_blitz --force-table db_div_blitz
if errorlevel 1 (
    echo ERRO: Falha na sincronizacao
    echo.
    pause
    exit /b 1
)

echo.
echo Processo concluido!
echo.
pause
