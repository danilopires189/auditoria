@echo off
chcp 65001 >nul
echo ====================================
echo Desativando Agendamento da Automação
echo ====================================
echo.

schtasks /delete /tn "AutomacaoInteligente20Min" /f

if %errorlevel% equ 0 (
    echo ✓ Tarefa agendada removida com sucesso!
) else (
    echo ✗ Erro ao remover tarefa ou tarefa não encontrada
)

echo.
pause
