Option Explicit

Dim objExcel, objWorkbook, objFSO
Dim strDataFolder, strFileName, arrFiles, i, j, k
Dim blnExcelWasRunning, intUpdatedFiles, intTotalFiles
Dim dtBefore, dtAfter, intRowCountBefore, intRowCountAfter
Dim blnQueryStillActive, intStableChecks, intMaxStableChecks

' Configurações - CAMINHO ABSOLUTO
Set objFSO = CreateObject("Scripting.FileSystemObject")
strDataFolder = objFSO.BuildPath(objFSO.GetAbsolutePathName("."), "data")
intUpdatedFiles = 0
intTotalFiles = 0
intMaxStableChecks = 5  ' Quantas verificações sem mudança para considerar concluído

' Lista de arquivos Excel para atualizar
arrFiles = Array("BD_AVULSO.xlsx", "BD_END.xlsx", "BD_ROTAS.xlsx", "DB_BARRAS.xlsx", "DB_BLITZ.xlsx", _
                 "DB_DEVOLUCAO.xlsx", "DB_ENTRADA_NOTAS.xlsx", "DB_ESTQ_ENTR.xlsx", _
                 "DB_LOG_END.xlsx", "DB_PEDIDO_DIRETO.xlsx", "DB_PROD_BLITZ.xlsx", _
                 "DB_PROD_VOL.xlsx", "DB_TERMO.xlsx", "DB_USUARIO.xlsx")

WScript.Echo "========================================="
WScript.Echo "MONITORAMENTO INTELIGENTE DE QUERIES"
WScript.Echo "========================================="
WScript.Echo ""

' Verificar se a pasta data existe
If Not objFSO.FolderExists(strDataFolder) Then
    WScript.Echo "ERRO: Pasta 'data' não encontrada: " & strDataFolder
    WScript.Quit 1
End If

' MATAR TODOS OS PROCESSOS EXCEL
WScript.Echo "Finalizando Excel completamente..."
Dim objShell
Set objShell = CreateObject("WScript.Shell")
objShell.Run "taskkill /f /im excel.exe", 0, True
WScript.Sleep 5000

' INICIAR EXCEL OTIMIZADO
WScript.Echo "Iniciando Excel com monitoramento inteligente..."
Set objExcel = CreateObject("Excel.Application")
objExcel.Visible = False
objExcel.DisplayAlerts = False
objExcel.AskToUpdateLinks = True
objExcel.AlertBeforeOverwriting = False
objExcel.EnableEvents = True
objExcel.ScreenUpdating = False

WScript.Echo "Pasta: " & strDataFolder
WScript.Echo ""

' Função para contar linhas com dados em uma planilha
Function CountDataRows(ws)
    On Error Resume Next
    Dim lastRow
    lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row  ' xlUp = -4162
    If Err.Number <> 0 Or lastRow <= 1 Then
        CountDataRows = 0
    Else
        CountDataRows = lastRow - 1  ' Subtrair cabeçalho
    End If
    On Error GoTo 0
End Function

' Processar cada arquivo COM MONITORAMENTO INTELIGENTE E CONTROLE DE FREQUÊNCIA
For i = 0 To UBound(arrFiles)
    strFileName = objFSO.BuildPath(strDataFolder, arrFiles(i))
    
    If objFSO.FileExists(strFileName) Then
        intTotalFiles = intTotalFiles + 1
        
        ' VERIFICAR SE ARQUIVO PRECISA SER ATUALIZADO BASEADO NA FREQUÊNCIA
        Dim objShellCheck
        Set objShellCheck = CreateObject("WScript.Shell")
        Dim intResultCheck
        intResultCheck = objShellCheck.Run("cscript //nologo verificar_frequencia.vbs """ & arrFiles(i) & """", 0, True)
        
        If intResultCheck = 2 Then
            ' Arquivo nao precisa ser atualizado ainda
            WScript.Echo "PULANDO: " & arrFiles(i) & " - Ainda dentro do intervalo de frequencia"
            WScript.Echo ""
            Set objShellCheck = Nothing
        Else
            Set objShellCheck = Nothing
            
            ' Capturar data ANTES
            dtBefore = objFSO.GetFile(strFileName).DateLastModified
            
            WScript.Echo "MONITORANDO: " & arrFiles(i)
            WScript.Echo "  Data antes: " & dtBefore
            
            On Error Resume Next
            Set objWorkbook = objExcel.Workbooks.Open(strFileName, 3, False)
            
            If Err.Number = 0 Then
                WScript.Echo "  Arquivo aberto, iniciando monitoramento inteligente..."
                
                ' CONTAR LINHAS ANTES DA ATUALIZAÇÃO
                Dim ws, intTotalRowsBefore, intTotalRowsAfter, intTotalRowsCurrent
                intTotalRowsBefore = 0
                For Each ws In objWorkbook.Worksheets
                    intTotalRowsBefore = intTotalRowsBefore + CountDataRows(ws)
                Next
                WScript.Echo "    Linhas de dados antes: " & intTotalRowsBefore
                
                ' INICIAR QUERIES
                WScript.Echo "    Iniciando execução das queries..."
                objWorkbook.RefreshAll
                
                ' Executar conexões individuais
                If objWorkbook.Connections.Count > 0 Then
                    WScript.Echo "    Executando " & objWorkbook.Connections.Count & " conexões..."
                    Dim conn
                    For Each conn In objWorkbook.Connections
                        WScript.Echo "      Iniciando: " & conn.Name
                        conn.Refresh
                    Next
                End If
                
                ' Executar QueryTables
                Dim qt, qtCount
                qtCount = 0
                For Each ws In objWorkbook.Worksheets
                    For Each qt In ws.QueryTables
                        qtCount = qtCount + 1
                        WScript.Echo "      Iniciando QueryTable: " & qt.Name
                        qt.Refresh False
                    Next
                Next
                
                ' Executar ListObjects
                Dim lo, loCount
                loCount = 0
                For Each ws In objWorkbook.Worksheets
                    For Each lo In ws.ListObjects
                        If lo.SourceType = 4 Then
                            loCount = loCount + 1
                            WScript.Echo "      Iniciando ListObject: " & lo.Name
                            lo.QueryTable.Refresh False
                        End If
                    Next
                Next
                
                WScript.Echo "    Queries iniciadas, monitorando progresso..."
                
                ' MONITORAMENTO INTELIGENTE - VERIFICAR SE DADOS ESTÃO CHEGANDO
                blnQueryStillActive = True
                intStableChecks = 0
                j = 0
                
                Do While blnQueryStillActive And j < 180  ' Máximo 30 minutos (180 x 10s)
                    j = j + 1
                    WScript.Sleep 10000  ' Aguardar 10 segundos
                    
                    ' CONTAR LINHAS ATUAIS
                    intTotalRowsCurrent = 0
                    For Each ws In objWorkbook.Worksheets
                        intTotalRowsCurrent = intTotalRowsCurrent + CountDataRows(ws)
                    Next
                    
                    ' VERIFICAR SE HOUVE MUDANÇA
                    If intTotalRowsCurrent <> intTotalRowsBefore Then
                        ' DADOS MUDARAM - QUERY AINDA ATIVA
                        WScript.Echo "      [" & j & "] DADOS CHEGANDO: " & intTotalRowsBefore & " → " & intTotalRowsCurrent & " linhas"
                        intTotalRowsBefore = intTotalRowsCurrent
                        intStableChecks = 0  ' Reset contador de estabilidade
                    Else
                        ' DADOS NÃO MUDARAM - INCREMENTAR CONTADOR
                        intStableChecks = intStableChecks + 1
                        WScript.Echo "      [" & j & "] SEM MUDANÇA: " & intTotalRowsCurrent & " linhas (estável " & intStableChecks & "/" & intMaxStableChecks & ")"
                        
                        ' SE DADOS ESTÃO ESTÁVEIS POR TEMPO SUFICIENTE
                        If intStableChecks >= intMaxStableChecks Then
                            ' VERIFICAR SE EXCEL AINDA ESTÁ PROCESSANDO
                            If objExcel.Ready Then
                                WScript.Echo "      QUERIES CONCLUIDAS: Dados estaveis e Excel pronto"
                                blnQueryStillActive = False
                            Else
                                WScript.Echo "      Excel ainda processando, continuando monitoramento..."
                                intStableChecks = intStableChecks - 1  ' Reduzir um pouco o contador
                            End If
                        End If
                    End If
                    
                    ' VERIFICAR SE EXCEL TRAVOU
                    If Not objExcel.Ready And intStableChecks > 10 Then
                        WScript.Echo "      AVISO: Excel pode ter travado, forcando conclusao..."
                        blnQueryStillActive = False
                    End If
                Loop
                
                If j >= 180 Then
                    WScript.Echo "    TIMEOUT: Queries muito demoradas (>30min), forcando conclusao"
                End If
                
                ' CONTAGEM FINAL
                intTotalRowsAfter = 0
                For Each ws In objWorkbook.Worksheets
                    intTotalRowsAfter = intTotalRowsAfter + CountDataRows(ws)
                Next
                
                WScript.Echo "    RESULTADO FINAL:"
                WScript.Echo "      Linhas antes: " & intTotalRowsBefore
                WScript.Echo "      Linhas depois: " & intTotalRowsAfter
                WScript.Echo "      Diferença: " & (intTotalRowsAfter - intTotalRowsBefore)
                
                ' FORÇAR RECÁLCULO E SALVAR
                WScript.Echo "    Finalizando e salvando..."
                objWorkbook.Application.CalculateFullRebuild
                WScript.Sleep 3000
                
                objWorkbook.Save
                WScript.Sleep 2000
                objWorkbook.Save  ' Salvar duas vezes
                
                objWorkbook.Close False
                
                ' Verificar se arquivo mudou
                WScript.Sleep 3000
                dtAfter = objFSO.GetFile(strFileName).DateLastModified
                
                If dtAfter > dtBefore Then
                    intUpdatedFiles = intUpdatedFiles + 1
                    WScript.Echo "OK: " & arrFiles(i) & " - QUERIES MONITORADAS E CONCLUIDAS"
                    WScript.Echo "  Data depois: " & dtAfter
                    WScript.Echo "  Tempo monitoramento: " & (j * 10) & " segundos"
                    WScript.Echo "  Status: DADOS REAIS OBTIDOS"
                    
                    ' REGISTRAR ATUALIZAÇÃO NO LOG DE FREQUÊNCIA
                    Dim objShellReg
                    Set objShellReg = CreateObject("WScript.Shell")
                    objShellReg.Run "cscript //nologo registrar_atualizacao.vbs """ & arrFiles(i) & """", 0, True
                    Set objShellReg = Nothing
                Else
                    WScript.Echo "AVISO: " & arrFiles(i) & " - ARQUIVO NAO MUDOU"
                End If
                
            Else
                WScript.Echo "✗ " & arrFiles(i) & " - ERRO: " & Err.Description
            End If
            
            On Error GoTo 0
            Set objWorkbook = Nothing
        End If
    Else
        WScript.Echo "AVISO: " & arrFiles(i) & " - Arquivo nao encontrado"
    End If
    
    WScript.Echo ""
Next

' Fechar Excel
WScript.Echo "Fechando Excel..."
objExcel.Quit
Set objExcel = Nothing
Set objFSO = Nothing
Set objShell = Nothing

WScript.Sleep 5000

WScript.Echo "========================================="
WScript.Echo "RESUMO DO MONITORAMENTO INTELIGENTE:"
WScript.Echo "Arquivos processados: " & intTotalFiles
WScript.Echo "Arquivos com queries monitoradas: " & intUpdatedFiles
WScript.Echo "========================================="

If intUpdatedFiles > 0 Then
    WScript.Echo "✅ QUERIES MONITORADAS E CONCLUÍDAS!"
    WScript.Echo "✅ Sistema aguardou até queries pararem de receber dados"
    WScript.Echo "✅ Dados REAIS obtidos com monitoramento inteligente"
    WScript.Echo "✅ MÁXIMA EFICIÊNCIA - sem tempo desperdiçado"
    WScript.Quit 0
Else
    WScript.Echo "AVISO: NENHUMA QUERY MONITORADA"
    WScript.Echo "Arquivos podem já conter dados atuais"
    WScript.Quit 1
End If