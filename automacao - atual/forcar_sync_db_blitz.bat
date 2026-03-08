@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   FORÇAR SINCRONIZAÇÃO DB_BLITZ
echo ==========================================
echo.
echo 🎯 Este script vai forçar a criação das tabelas DB_BLITZ
echo.

echo ✅ Aplicando migrations necessárias...
sync_backend_cli.exe bootstrap
if errorlevel 1 (
    echo ❌ ERRO: Falha ao aplicar migrations do DB_BLITZ
    echo.
    pause
    exit /b 1
)

echo ✅ Executando sincronização completa...
sync_backend_cli.exe sync
if errorlevel 1 (
    echo ❌ ERRO: Falha na sincronização
    echo.
    pause
    exit /b 1
)

echo.
echo ✅ Sincronização concluída!
echo.
pause
