@echo off
chcp 65001 >nul
cls

echo ==========================================
echo   MONITOR DB_DEVOLUCAO - A CADA 5 MINUTOS
echo ==========================================
echo Data/Hora: %date% %time%
echo.
echo 🎯 MONITORAMENTO ESPECÍFICO:
echo • Verifica DB_DEVOLUCAO a cada 5 minutos
echo • Horário de funcionamento: 06:00 às 20:00
echo • Só sincroniza se houver dados novos
echo • Não interfere no fluxo principal
echo • Mantém aplicação sempre atualizada
echo.
echo ⏰ CONTROLE DE HORÁRIO:
echo • Das 06:00 às 20:00: Monitora a cada 5 minutos
echo • Das 20:00 às 06:00: Standby (verifica a cada 5 min se chegou no horário)
echo.

echo Iniciando monitor com controle de horário...
cscript //nologo "%~dp0monitor_devolucao_horario.vbs"

pause