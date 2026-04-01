@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   FECHAR EXCEL E SINCRONIZAR DB_BLITZ
echo ==========================================
echo.
echo 🛑 Fechando Excel e todos os processos relacionados...

REM Fechar Excel e outros processos
taskkill /f /im excel.exe 2>nul
taskkill /f /im python.exe 2>nul
taskkill /f /im sync_backend_cli.exe 2>nul
taskkill /f /im wscript.exe 2>nul
taskkill /f /im cscript.exe 2>nul

echo ⏳ Aguardando 5 segundos para liberar arquivos...
timeout /t 5 /nobreak >nul

echo.
echo ✅ Aplicando migrations necessárias...
sync_backend_cli.exe bootstrap
if errorlevel 1 (
    echo ❌ ERRO: Falha ao aplicar migrations do DB_BLITZ
    echo.
    pause
    exit /b 1
)

echo.
echo ✅ Executando sincronização apenas das tabelas DB_BLITZ...
sync_backend_cli.exe sync --table db_conf_blitz
if errorlevel 1 (
    echo ❌ ERRO: Falha ao sincronizar db_conf_blitz
    echo.
    pause
    exit /b 1
)
echo.
sync_backend_cli.exe sync --table db_div_blitz
if errorlevel 1 (
    echo ❌ ERRO: Falha ao sincronizar db_div_blitz
    echo.
    pause
    exit /b 1
)

echo.
echo ✅ Sincronização das tabelas DB_BLITZ concluída!
echo.
pause
