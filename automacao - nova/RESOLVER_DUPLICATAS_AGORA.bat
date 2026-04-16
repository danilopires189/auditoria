@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   RESOLVER DUPLICATAS DB_END - URGENTE
echo ==========================================
echo.
echo 🚨 PROBLEMA IDENTIFICADO:
echo • Há duplicatas no arquivo BD_END.xlsx
echo • Registro duplicado: cd=4, coddv=574112, endereco="DB1 .050.051.775", tipo="SEP"
echo • Mesmo com full_replace, o sistema não consegue processar duplicatas
echo.
echo 🛠️  SOLUÇÃO:
echo • Limpar duplicatas do Excel ANTES da sincronização
echo • Manter apenas o primeiro registro de cada duplicata
echo • Fazer backup automático do arquivo original
echo.

choice /c SN /m "Deseja executar a limpeza de duplicatas agora"

if errorlevel 2 (
    echo Operação cancelada.
    pause
    exit /b
)

echo.
echo 🧹 EXECUTANDO LIMPEZA DE DUPLICATAS...
echo.

python scripts/limpar_duplicatas_bd_end.py

if errorlevel 1 (
    echo ❌ ERRO na limpeza de duplicatas
    echo Verifique se o Python está instalado e o arquivo Excel existe
    pause
    exit /b
)

echo.
echo ✅ LIMPEZA CONCLUÍDA!
echo.
echo 🚀 EXECUTANDO SINCRONIZAÇÃO...
echo.

call sync_backend_cli_runner.bat sync --table db_end

if errorlevel 1 (
    echo ❌ ERRO na sincronização
    echo Verifique os logs para mais detalhes
) else (
    echo ✅ SINCRONIZAÇÃO CONCLUÍDA COM SUCESSO!
)

echo.
echo ==========================================
echo   PROCESSO FINALIZADO
echo ==========================================
pause
