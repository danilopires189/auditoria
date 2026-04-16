@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   PARAR E SINCRONIZAR DB_BLITZ
echo ==========================================
echo.
echo 🛑 Parando processos de sincronização ativos...

REM Parar processos Python relacionados à sincronização
taskkill /f /im python.exe 2>nul
taskkill /f /im sync_backend_cli.exe 2>nul

echo ⏳ Aguardando 3 segundos...
timeout /t 3 /nobreak >nul

echo.
echo ✅ Aplicando migrations necessárias...
call sync_backend_cli_runner.bat bootstrap
if errorlevel 1 (
    echo ❌ ERRO: Falha ao aplicar migrations do DB_BLITZ
    echo.
    pause
    exit /b 1
)

echo.
echo ✅ Executando sincronização das tabelas DB_BLITZ...
call sync_backend_cli_runner.bat sync --table db_conf_blitz
if errorlevel 1 (
    echo ❌ ERRO: Falha ao sincronizar db_conf_blitz
    echo.
    pause
    exit /b 1
)
call sync_backend_cli_runner.bat sync --table db_div_blitz
if errorlevel 1 (
    echo ❌ ERRO: Falha ao sincronizar db_div_blitz
    echo.
    pause
    exit /b 1
)

echo.
echo ✅ Sincronização concluída!
echo.
pause
