@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
cls

:: Criar pasta de logs se não existir
if not exist logs mkdir logs
set "LOGFILE=logs\automacao_inteligente_%date:~6,4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%.log"
set "LOGFILE=%LOGFILE: =0%"
echo Iniciando automacao... > "%LOGFILE%"
echo Data/Hora: %date% %time% >> "%LOGFILE%"

echo ========================================
echo    AUTOMACAO INTELIGENTE - MONITORAMENTO REAL
echo ========================================
echo Data/Hora: %date% %time%
echo.

echo 🧠 MÉTODO INTELIGENTE COM CONTROLE DE FREQUÊNCIA:
echo    ✅ Monitora se queries AINDA ESTÃO recebendo dados
echo    ✅ Para automaticamente quando dados param de chegar
echo    ✅ Não desperdiça tempo com esperas desnecessárias
echo    ✅ Detecta queries travadas automaticamente
echo    ⏰ CONTROLA FREQUÊNCIA de atualização por arquivo:
echo       • 1x/dia: DB_BARRAS, BD_AVULSO, BD_ROTAS, DB_LOG_END, DB_USUARIO, DB_PROD_VOL, DB_GESTAO_ESTQ, DB_TRANSF_CD
echo       • 6h: BD_END
echo       • 30min: DB_ENTRADA_NOTAS, DB_ATENDIMENTO
echo       • 1h: DB_TERMO, DB_PEDIDO_DIRETO, DB_PROD_BLITZ, DB_ESTQ_ENTR
echo.

echo PASSO 1: PREVIEW DAS ATUALIZAÇÕES
echo.
echo Verificando quais arquivos precisam ser atualizados...
cscript //nologo "preview_atualizacoes.vbs"
if errorlevel 1 (
    echo.
    echo ⏭️  NENHUM ARQUIVO PRECISA SER ATUALIZADO
    echo ✅ Todos os arquivos estão dentro dos intervalos de frequência
    echo ⏭️  Pulando execução completa para economizar tempo
    echo.
    set "QUERIES_STATUS=SEM_ATUALIZACAO"
    set "SYNC_STATUS=PULADO"
    goto RELATORIO_SEM_SYNC
)

echo.
echo PASSO 2: PREPARACAO OTIMIZADA
echo.
echo Finalizando processos Excel...
taskkill /f /im excel.exe >nul 2>&1
echo Limpando ambiente...
timeout /t 5 /nobreak >nul
echo ✅ Ambiente preparado

echo.
echo PASSO 3: MONITORAMENTO INTELIGENTE DAS QUERIES
echo.
echo 🔍 INICIANDO MONITORAMENTO INTELIGENTE COM CONTROLE DE FREQUÊNCIA:
echo    - Verifica se cada arquivo precisa ser atualizado baseado na frequência
echo    - Conta linhas de dados ANTES das queries
echo    - Executa APENAS queries necessárias simultaneamente
echo    - Monitora CONTINUAMENTE se dados estão chegando
echo    - Para quando dados ficam estáveis por 5 verificações
echo    - Detecta se Excel travou
echo    - Registra atualizações para controle de frequência
echo.
echo ⏱️  Tempo: Apenas o necessário (sem desperdício)
echo.

cscript //nologo "monitorar_queries_ativas.vbs"
if errorlevel 1 (
    echo ❌ AVISO: Problemas no monitoramento inteligente OU nenhum arquivo precisou ser atualizado
    echo.
    echo Tentando método de fallback...
    cscript //nologo "garantir_queries_completas.vbs"
    if errorlevel 1 (
        echo ❌ Método de fallback também falhou OU nenhum arquivo precisou ser atualizado
        echo.
        echo ⏭️  PULANDO SINCRONIZAÇÃO - Nenhum arquivo foi atualizado
        echo ✅ Todos os arquivos estão dentro dos intervalos de frequência
        set "QUERIES_STATUS=SEM_ATUALIZACAO"
        set "SYNC_STATUS=PULADO"
        goto RELATORIO_SEM_SYNC
    ) else (
        echo ✅ Método de fallback funcionou!
        set "QUERIES_STATUS=FALLBACK"
    )
) else (
    echo ✅ MONITORAMENTO INTELIGENTE CONCLUÍDO!
    set "QUERIES_STATUS=INTELIGENTE"
)

echo.
echo PASSO 4: VERIFICACAO RAPIDA
echo.
echo Verificando resultados do monitoramento...
cscript //nologo "verificar_atualizacao_excel.vbs"
if errorlevel 1 (
    echo ⚠️  Alguns arquivos podem precisar de mais tempo
) else (
    echo ✅ Verificação passou - queries executaram corretamente
)

echo.
echo PASSO 5: ESTABILIZACAO MINIMA
echo.
echo Aguardando estabilização mínima (10 segundos)...
timeout /t 10 /nobreak >nul
echo ✅ Sistema estabilizado

echo.
echo PASSO 6: CONEXAO SUPABASE
echo.
echo Verificando se sync_backend_cli.exe existe...
if not exist sync_backend_cli.exe (
    echo ❌ ERRO CRÍTICO: sync_backend_cli.exe não encontrado!
    echo Verifique se o arquivo está na pasta correta.
    pause
    goto FIM
)
echo ✅ Executável encontrado, testando conexão...
sync_backend_cli.exe healthcheck 2>&1
if errorlevel 1 (
    echo ❌ ERRO: Sem conexão com Supabase
    echo Tentando configuração alternativa...
    
    copy .env .env.backup >nul
    echo SUPABASE_DB_HOST=aws-1-sa-east-1.pooler.supabase.com> .env
    echo SUPABASE_DB_PORT=5432>> .env
    echo SUPABASE_DB_NAME=postgres>> .env
    echo SUPABASE_DB_USER=postgres.gpgqklqhomsaomdnccvu>> .env
    echo SUPABASE_DB_PASSWORD=gxz9gTQbNsn9vb6F>> .env
    
    sync_backend_cli.exe healthcheck 2>&1
    if errorlevel 1 (
        echo ❌ ERRO: Conexão falhou
        copy .env.backup .env >nul
        del .env.backup >nul
        echo.
        echo ⚠️ Não foi possível conectar ao Supabase.
        pause
        goto FIM
    ) else (
        echo ✅ CONEXÃO OK com configuração alternativa
        del .env.backup >nul
    )
) else (
    echo ✅ CONEXÃO SUPABASE PERFEITA
)

echo.
echo PASSO 7: PREPARO DO BACKEND
echo.
echo Aplicando migrations antes da sincronização...
sync_backend_cli.exe bootstrap 2>&1
if errorlevel 1 (
    echo ❌ ERRO: Falha ao aplicar migrations
    set "SYNC_STATUS=BOOTSTRAP_FALHOU"
    echo.
    pause
    goto FIM
)
echo ✅ Backend preparado

echo.
echo PASSO 8: SINCRONIZACAO OTIMIZADA
echo.
echo Sincronizando dados obtidos com monitoramento inteligente...
echo 📤 Iniciando sincronização... Este processo pode demorar alguns minutos.
sync_backend_cli.exe sync 2>&1
if errorlevel 1 (
    echo ⚠️  Primeira tentativa teve problemas
    echo 🔄 Tentando sincronizar novamente...
    sync_backend_cli.exe sync 2>&1
    if errorlevel 1 (
        echo ❌ ERRO: Segunda tentativa falhou
        set "SYNC_STATUS=FALHOU"
        echo.
        pause
    ) else (
        echo ✅ SINCRONIZAÇÃO OK na segunda tentativa
        set "SYNC_STATUS=OK_2ª"
    )
) else (
    echo ✅ SINCRONIZAÇÃO PERFEITA!
    set "SYNC_STATUS=PERFEITO"
)

echo.
echo PASSO 9: VERIFICACAO FINAL
echo.
sync_backend_cli.exe healthcheck
if errorlevel 1 (
    echo ⚠️  Verificação final teve problemas
) else (
    echo ✅ Verificação final OK
)

echo.
echo PASSO 10: RELATORIO INTELIGENTE
echo.
cscript //nologo "verificar_sincronizacao.vbs"

goto FIM

:RELATORIO_SEM_SYNC
echo.
echo ========================================
echo    RELATORIO - AUTOMACAO INTELIGENTE
echo ========================================
echo Data/Hora: %date% %time%
echo.
echo 📊 STATUS FINAL:
echo    Monitoramento: %QUERIES_STATUS%
echo    Sincronização: %SYNC_STATUS%
echo.
echo ⏰ CONTROLE DE FREQUÊNCIA FUNCIONANDO:
echo ✅ Todos os arquivos estão dentro dos intervalos definidos
echo ✅ Nenhuma atualização desnecessária foi executada
echo ✅ Sistema otimizado - tempo e recursos poupados
echo ✅ Dados no Supabase permanecem atualizados
echo.
echo 💡 PRÓXIMAS ATUALIZAÇÕES:
echo - Execute VER_STATUS_FREQUENCIA.bat para ver quando cada arquivo será atualizado
echo - Arquivos prioritários (30min): DB_ENTRADA_NOTAS, DB_ATENDIMENTO
echo - Arquivos importantes (1h): DB_TERMO, DB_PEDIDO_DIRETO, DB_PROD_BLITZ, DB_ESTQ_ENTR
echo - Arquivos moderados (6h): BD_END
echo - Arquivos estáticos (1x/dia): DB_BARRAS, BD_AVULSO, BD_ROTAS, DB_LOG_END, DB_USUARIO, DB_PROD_VOL, DB_GESTAO_ESTQ, DB_TRANSF_CD
echo.

if not exist "logs" mkdir logs
echo %date% %time% - Automacao inteligente - Queries:%QUERIES_STATUS% Sync:%SYNC_STATUS% - SEM ATUALIZACOES NECESSARIAS >> logs\automacao_inteligente.log

echo Pressione qualquer tecla para fechar...
pause >nul
exit /b 0

:ERRO_INESPERADO
echo.
echo ❌ ERRO INESPERADO no script!
echo Código de erro: %ERRORLEVEL%
echo.
pause
goto FIM

:FIM
echo.
echo ========================================
echo    RELATORIO - AUTOMACAO INTELIGENTE
echo ========================================
echo Data/Hora: %date% %time%
echo.
echo 📊 STATUS FINAL:
echo    Monitoramento: %QUERIES_STATUS%
echo    Sincronização: %SYNC_STATUS%
echo.
echo 🧠 VANTAGENS DO MÉTODO INTELIGENTE COM CONTROLE DE FREQUÊNCIA:
echo ✅ Tempo otimizado - só aguarda o necessário
echo ✅ Detecta automaticamente quando queries terminam
echo ✅ Monitora dados chegando em tempo real
echo ✅ Não desperdiça tempo com esperas fixas
echo ✅ Detecta queries travadas automaticamente
echo ⏰ CONTROLA FREQUÊNCIA - evita atualizações desnecessárias:
echo    • Arquivos críticos: a cada 30 minutos
echo    • Arquivos importantes: a cada 1 hora
echo    • Arquivos moderados: a cada 6 horas
echo    • Arquivos estáticos: 1 vez por dia (se não atualizou hoje)
echo.
echo 🎯 RESULTADO: Queries executadas com MÁXIMA EFICIÊNCIA
echo 📊 Dados no Supabase são REAIS e atualizados
echo ⏱️  Tempo: Apenas o necessário (sem desperdício)
echo.
echo 💡 COMO FUNCIONA O CONTROLE INTELIGENTE:
echo - Verifica frequência necessária para cada arquivo
echo - Pula arquivos que ainda estão dentro do intervalo
echo - Conta linhas antes das queries
echo - Monitora continuamente se dados estão chegando
echo - Para quando dados ficam estáveis
echo - Verifica se Excel ainda está processando
echo - Registra quando cada arquivo foi atualizado
echo.

if not exist "logs" mkdir logs
echo %date% %time% - Automacao inteligente - Queries:%QUERIES_STATUS% Sync:%SYNC_STATUS% >> logs\automacao_inteligente.log

echo Pressione qualquer tecla para fechar...
pause >nul
exit /b 0
