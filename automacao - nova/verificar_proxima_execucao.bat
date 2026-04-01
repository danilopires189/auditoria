@echo off
chcp 65001 >nul
echo ====================================
echo Verificando Próxima Execução
echo ====================================
echo.

REM Verificar se a tarefa existe
schtasks /query /tn "AutomacaoInteligente20Min" >nul 2>&1

if %errorlevel% equ 0 (
    echo ✓ Tarefa agendada encontrada!
    echo.
    echo Detalhes da tarefa:
    echo -----------------------------------
    schtasks /query /tn "AutomacaoInteligente20Min" /fo LIST /v | findstr /i "Nome Status Próxima Última Horário Repetir"
    echo.
    echo -----------------------------------
    echo.
    echo Informações completas:
    schtasks /query /tn "AutomacaoInteligente20Min" /fo LIST /v
) else (
    echo ✗ Tarefa agendada NÃO encontrada!
    echo.
    echo A automação não está configurada.
    echo Execute o arquivo 'agendar_automacao.bat' como Administrador para configurar.
)

echo.
echo ====================================
echo Hora atual: %date% %time%
echo ====================================
echo.
pause
