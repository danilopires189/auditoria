@echo off
chcp 65001 >nul
echo ====================================
echo Iniciando Automação a cada 30 minutos
echo ====================================
echo.
echo Horário de funcionamento: 06:00 às 20:00
echo Intervalo: 30 minutos
echo.
echo 🎯 FREQUÊNCIAS CONFIGURADAS:
echo • 30min: DB_ENTRADA_NOTAS
echo • 5min: DB_DEVOLUCAO (monitor dedicado - inicie separadamente)
echo • 1h: DB_TERMO, DB_PEDIDO_DIRETO, DB_PROD_BLITZ, DB_ESTQ_ENTR
echo • 6h: BD_END
echo • 1x/dia: DB_BARRAS, BD_AVULSO, BD_ROTAS, DB_LOG_END, DB_USUARIO, DB_PROD_VOL, DB_GESTAO_ESTQ
echo.
echo ⚠️  IMPORTANTE: Para DB_DEVOLUCAO atualizar a cada 5min,
echo    execute também: INICIAR_MONITOR_DEVOLUCAO.bat
echo.
echo O script ficará rodando em segundo plano.
echo Para parar, feche a janela ou use Ctrl+C
echo.
echo Iniciando...
echo.

cscript //nologo "%~dp0executar_automacao_20min_v2.vbs"

pause
