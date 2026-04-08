@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   SISTEMA COMPLETO DE AUTOMAÇÃO
echo ==========================================
echo Data/Hora: %date% %time%
echo.
echo 🎯 ESTE SCRIPT INICIA TUDO:
echo.
echo 📊 AUTOMAÇÃO PRINCIPAL (30 minutos):
echo • DB_ENTRADA_NOTAS, DB_ATENDIMENTO (30min)
echo • DB_TERMO, DB_PEDIDO_DIRETO, DB_PROD_BLITZ, DB_ESTQ_ENTR (1h)
echo • DB_CONF_BLITZ, DB_DIV_BLITZ (30min)
echo • BD_END (6h)
echo • DB_BARRAS, BD_AVULSO, BD_ROTAS, DB_LOG_END, DB_USUARIO, DB_PROD_VOL, DB_GESTAO_ESTQ (1x/dia)
echo.
echo 🚀 MONITOR DEDICADO (5 minutos):
echo • DB_DEVOLUCAO (sempre atualizado)
echo.
echo ⚠️  IMPORTANTE:
echo • Serão abertas 2 janelas separadas
echo • Automação Principal: A cada 30 minutos
echo • Monitor DB_DEVOLUCAO: A cada 5 minutos
echo • Ambos funcionam independentemente
echo.

choice /c SN /m "Deseja iniciar o sistema completo"

if errorlevel 2 (
    echo Operação cancelada.
    pause
    exit /b
)

echo.
echo ✅ Iniciando sistema completo...
echo.

REM Iniciar automação principal em nova janela
echo 📊 Iniciando Automação Principal (30min)...
start "Automação Principal - 30min" INICIAR_AUTOMACAO_20MIN.bat

REM Aguardar um pouco
timeout /t 3 /nobreak >nul

REM Iniciar monitor DB_DEVOLUCAO em nova janela
echo 🚀 Iniciando Monitor DB_DEVOLUCAO (5min)...
start "Monitor DB_DEVOLUCAO - 5min" INICIAR_MONITOR_DEVOLUCAO.bat

echo.
echo ✅ Sistema completo iniciado!
echo.
echo 📋 JANELAS ABERTAS:
echo • Automação Principal - 30min
echo • Monitor DB_DEVOLUCAO - 5min
echo.
echo 💡 Para parar:
echo • Feche as janelas individuais
echo • Ou use o Gerenciador de Tarefas
echo.

pause
