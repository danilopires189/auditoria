@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   SINCRONIZAÇÃO SEM DB_BLITZ
echo ==========================================
echo.
echo ℹ️  Esta rotina agora usa o backend mais atual disponível
echo    priorizando o código-fonte do projeto quando existir.
echo.
echo ✅ Executando sincronização...
call sync_backend_cli_runner.bat sync

echo.
echo 📋 PRÓXIMOS PASSOS:
echo.
echo 1. Verifique o resultado da sincronização nos logs
echo 2. Se houver mudança de schema, rode o bootstrap antes
echo 3. A planilha e a tabela precisam apontar para a mesma configuração local
echo.
echo 💡 SOLUÇÕES:
echo • Use AUTOMACAO_INTELIGENTE.bat para o fluxo completo
echo • Use bootstrap quando houver migrations novas
echo • Consulte logs\\app.log em caso de falha
echo.
pause
