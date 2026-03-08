@echo off
chcp 65001 >nul
echo ====================================
echo Configurando Agendamento da Automação
echo ====================================
echo.

REM Obter caminho completo do arquivo
set "CAMINHO_COMPLETO=%~dp0AUTOMACAO_INTELIGENTE.bat"

REM Criar tarefa agendada no Windows
schtasks /create /tn "AutomacaoInteligente20Min" /tr "\"%CAMINHO_COMPLETO%\"" /sc minute /mo 20 /st 06:00 /et 20:00 /f

if %errorlevel% equ 0 (
    echo ✓ Tarefa agendada com sucesso!
    echo.
    echo Configuração:
    echo - Nome: AutomacaoInteligente20Min
    echo - Frequência: A cada 30 minutos
    echo - Horário: Das 06:00 às 20:00
    echo - Arquivo: AUTOMACAO_INTELIGENTE.bat
    echo.
    echo ⚠️  IMPORTANTE: Este agendamento NÃO inclui DB_DEVOLUCAO
    echo    Para DB_DEVOLUCAO (5min), execute separadamente:
    echo    INICIAR_MONITOR_DEVOLUCAO.bat
    echo.
    echo Para verificar: schtasks /query /tn "AutomacaoInteligente20Min"
    echo Para desativar: schtasks /delete /tn "AutomacaoInteligente20Min" /f
) else (
    echo ✗ Erro ao criar tarefa agendada
    echo Execute este arquivo como Administrador
)

echo.
pause
