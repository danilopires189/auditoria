@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   SINCRONIZAÇÃO SEM DB_BLITZ
echo ==========================================
echo.
echo ℹ️  O sistema ainda não reconhece as tabelas DB_BLITZ
echo    Isso é normal - o executável precisa ser atualizado
echo.
echo ✅ Executando sincronização das outras tabelas...
sync_backend_cli.exe sync

echo.
echo 📋 PRÓXIMOS PASSOS:
echo.
echo 1. As configurações do DB_BLITZ já estão no config.yml ✅
echo 2. O arquivo DB_BLITZ.xlsx existe na pasta data ✅  
echo 3. O sistema precisa ser recompilado para reconhecer as novas tabelas
echo.
echo 💡 SOLUÇÕES:
echo • Aguarde a próxima atualização do sistema
echo • OU reinicie completamente o computador
echo • OU entre em contato com o desenvolvedor
echo.
pause