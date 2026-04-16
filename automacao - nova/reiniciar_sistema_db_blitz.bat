@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   REINICIAR SISTEMA PARA DB_BLITZ
echo ==========================================
echo.
echo 🛑 Parando TODOS os processos relacionados...

REM Parar processos mais agressivamente
taskkill /f /im python.exe 2>nul
taskkill /f /im sync_backend_cli.exe 2>nul
taskkill /f /im wscript.exe 2>nul
taskkill /f /im cscript.exe 2>nul

echo ⏳ Aguardando 5 segundos para garantir que tudo parou...
timeout /t 5 /nobreak >nul

echo.
echo ✅ Executando sincronização completa (vai incluir DB_BLITZ automaticamente)...
call sync_backend_cli_runner.bat sync

echo.
echo ✅ Processo concluído!
echo.
pause
