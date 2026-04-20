@echo off
chcp 65001 >nul
cls

echo ==========================================
echo    STATUS DE FREQUÊNCIA - TODOS OS ARQUIVOS
echo ==========================================
echo Data/Hora: %date% %time%
echo.

echo 🔍 VERIFICANDO STATUS DE FREQUÊNCIA DE CADA ARQUIVO:
echo.

cscript //NoLogo verificar_status_todos_arquivos.vbs

echo.
echo ==========================================
echo LEGENDA:
echo ✅ SERÁ PROCESSADO = Arquivo precisa ser atualizado
echo ⏭️  SERÁ PULADO = Arquivo ainda está no intervalo
echo ❓ ERRO = Problema na verificação
echo.
echo INTERVALOS CONFIGURADOS:
echo • 30min: DB_ENTRADA_NOTAS, DB_ATENDIMENTO
echo • 5min: DB_DEVOLUCAO (monitor dedicado)
echo • 1 HORA: DB_TERMO, DB_PEDIDO_DIRETO, DB_ESTQ_ENTR, DB_BLITZ  
echo • 6 HORAS: BD_END
echo • 1x POR DIA: DB_BARRAS, BD_AVULSO, BD_ROTAS, DB_LOG_END, DB_USUARIO, DB_PROD_VOL, DB_GESTAO_ESTQ, DB_TRANSF_CD
echo ==========================================
echo.
echo Pressione qualquer tecla para continuar...
pause >nul
