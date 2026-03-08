@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo AUTOMAÇÃO INTELIGENTE COM LIMPEZA DE DUPLICATAS
echo ========================================
echo Data/Hora: %date% %time%
echo.

echo 🧹 PASSO EXTRA: LIMPEZA DE DUPLICATAS
echo.
echo Limpando duplicatas do BD_END.xlsx antes da sincronização...
python scripts/limpar_duplicatas_bd_end.py
if errorlevel 1 (
    echo ❌ ERRO na limpeza de duplicatas
    echo Continuando mesmo assim...
) else (
    echo ✅ Limpeza de duplicatas concluída
)
echo.

echo 🚀 EXECUTANDO AUTOMAÇÃO NORMAL...
echo.
call AUTOMACAO_INTELIGENTE.bat

echo.
echo ========================================
echo AUTOMAÇÃO COM LIMPEZA CONCLUÍDA
echo ========================================
pause