@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   INICIANDO MONITOR DB_DEVOLUCAO
echo ==========================================
echo.
echo 🎯 CONFIGURAÇÃO:
echo • Frequência ativa: A cada 1 minuto
echo • Horário: 06:00 às 20:00 (standby fora do horário)
echo • Arquivo: DB_DEVOLUCAO.xlsx
echo • Ação: Sincroniza apenas se houver dados novos
echo • Modo: Execução contínua em segundo plano
echo.
echo ⚠️  IMPORTANTE:
echo • Este monitor roda INDEPENDENTE da automação principal
echo • Mantém DB_DEVOLUCAO sempre atualizado
echo • Não interfere nos outros arquivos
echo • Respeita horário comercial (6h às 20h)
echo • Fora do horário: standby a cada 5 minutos
echo.

choice /c SN /m "Deseja iniciar o monitor de DB_DEVOLUCAO"

if errorlevel 2 (
    echo Operação cancelada.
    pause
    exit /b
)

echo.
echo ✅ Iniciando monitor com controle de horário...
echo.
echo Para parar o monitor, feche esta janela ou pressione Ctrl+C
echo.

REM Iniciar o monitor com controle de horário
MONITOR_DEVOLUCAO_5MIN.bat
