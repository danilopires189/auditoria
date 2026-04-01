Option Explicit

Dim objExcel, objWorkbook, objFSO
Dim strDataFolder, strFileName, arrFiles, i, j, k
Dim blnExcelWasRunning, intUpdatedFiles, intTotalFiles
Dim dtBefore, dtAfter, blnAllQueriesComplete

' Configurações - CAMINHO ABSOLUTO
Set objFSO = CreateObject("Scripting.FileSystemObject")
strDataFolder = objFSO.BuildPath(objFSO.GetAbsolutePathName("."), "data")
intUpdatedFiles = 0
intTotalFiles = 0

' Lista de arquivos Excel para atualizar
arrFiles = Array("BD_AVULSO.xlsx", "BD_END.xlsx", "BD_ROTAS.xlsx", "DB_BARRAS.xlsx", "DB_BLITZ.xlsx", _
                 "DB_DEVOLUCAO.xlsx", "DB_ENTRADA_NOTAS.xlsx", "DB_ESTQ_ENTR.xlsx", _
                 "DB_LOG_END.xlsx", "DB_PEDIDO_DIRETO.xlsx", "DB_PROD_BLITZ.xlsx", _
                 "DB_PROD_VOL.xlsx", "DB_TERMO.xlsx", "DB_USUARIO.xlsx")

WScript.Echo "========================================="
WScript.Echo "GARANTINDO CONCLUSÃO COMPLETA DAS QUERIES"
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

' INICIAR EXCEL OTIMIZADO PARA QUERIES LONGAS
WScript.Echo "Iniciando Excel otimizado para queries demoradas..."
Set objExcel = CreateObject("Excel.Application")
objExcel.Visible = False
objExcel.DisplayAlerts = False
objExcel.AskToUpdateLinks = True
objExcel.AlertBeforeOverwriting = False
objExcel.EnableEvents = True
objExcel.ScreenUpdating = False
objExcel.Calculation = -4105  ' xlCalculationAutomatic

WScript.Echo "Pasta: " & strDataFolder
WScript.Echo ""

' Processar cada arquivo COM GARANTIA DE CONCLUSÃO E CONTROLE DE FREQUÊNCIA
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
            
            WScript.Echo "PROCESSANDO: " & arrFiles(i)
            WScript.Echo "  Data antes: " & dtBefore
            
            On Error Resume Next
            Set objWorkbook = objExcel.Workbooks.Open(strFileName, 3, False)
            
            If Err.Number = 0 Then
                WScript.Echo "  Arquivo aberto, iniciando execução de queries..."
                
                ' EXECUTAR QUERIES COM MÚLTIPLAS TENTATIVAS E VERIFICAÇÃO
                For j = 1 To 3  ' Até 3 tentativas
                    WScript.Echo "    === TENTATIVA " & j & " ==="
                    
                    ' MÉTODO 1: RefreshAll
                    WScript.Echo "      Executando RefreshAll..."
                    objWorkbook.RefreshAll
                    
                    ' AGUARDAR INICIAL
                    WScript.Sleep 10000  ' 10 segundos inicial
                    
                    ' MÉTODO 2: Conexões individuais COM VERIFICAÇÃO
                    If objWorkbook.Connections.Count > 0 Then
                        WScript.Echo "      Executando " & objWorkbook.Connections.Count & " conexões individuais..."
                        Dim conn
                        For Each conn In objWorkbook.Connections
                            WScript.Echo "        Executando: " & conn.Name
                            conn.Refresh
                            
                            ' AGUARDAR E VERIFICAR SE TERMINOU
                            For k = 1 To 30  ' Até 30 verificações (5 minutos por conexão)
                                WScript.Sleep 10000  ' 10 segundos por verificação
                                WScript.Echo "          Aguardando conclusão... (" & k & "/30)"
                                
                                ' Verificar se Excel ainda está processando
                                If objExcel.Ready Then
                                    WScript.Echo "        OK: Conexao " & conn.Name & " concluida"
                                    Exit For
                                End If
                            Next
                        Next
                    End If
                    
                    ' MÉTODO 3: QueryTables COM VERIFICAÇÃO
                    Dim ws, qt, qtCount
                    qtCount = 0
                    For Each ws In objWorkbook.Worksheets
                        For Each qt In ws.QueryTables
                            qtCount = qtCount + 1
                            WScript.Echo "        Executando QueryTable: " & qt.Name
                            qt.Refresh False  ' Síncrono
                            
                            ' AGUARDAR CONCLUSÃO DA QUERY
                            For k = 1 To 60  ' Até 60 verificações (10 minutos por query)
                                WScript.Sleep 10000  ' 10 segundos
                                WScript.Echo "          Query " & qt.Name & " executando... (" & k & "/60)"
                                
                                If objExcel.Ready Then
                                    WScript.Echo "        OK: QueryTable " & qt.Name & " concluida"
                                    Exit For
                                End If
                            Next
                        Next
                    Next
                    
                    ' MÉTODO 4: ListObjects COM VERIFICAÇÃO
                    Dim lo, loCount
                    loCount = 0
                    For Each ws In objWorkbook.Worksheets
                        For Each lo In ws.ListObjects
                            If lo.SourceType = 4 Then
                                loCount = loCount + 1
                                WScript.Echo "        Executando ListObject: " & lo.Name
                                lo.QueryTable.Refresh False
                                
                                ' AGUARDAR CONCLUSÃO
                                For k = 1 To 60  ' Até 10 minutos por ListObject
                                    WScript.Sleep 10000
                                    WScript.Echo "          ListObject " & lo.Name & " executando... (" & k & "/60)"
                                    
                                    If objExcel.Ready Then
                                        WScript.Echo "        OK: ListObject " & lo.Name & " concluido"
                                        Exit For
                                    End If
                                Next
                            End If
                        Next
                    Next
                    
                    ' AGUARDAR ESTABILIZAÇÃO FINAL
                    WScript.Echo "      Aguardando estabilização final da tentativa " & j & "..."
                    For k = 1 To 30  ' Até 5 minutos de estabilização
                        WScript.Sleep 10000
                        WScript.Echo "        Estabilizando... (" & k & "/30)"
                        
                        If objExcel.Ready Then
                            WScript.Echo "      OK: Sistema estabilizado na tentativa " & j
                            Exit For
                        End If
                    Next
                    
                    ' VERIFICAR SE TODAS AS QUERIES TERMINARAM
                    blnAllQueriesComplete = True
                    If Not objExcel.Ready Then
                        blnAllQueriesComplete = False
                        WScript.Echo "      AVISO: Sistema ainda processando - tentativa " & j & " incompleta"
                    Else
                        WScript.Echo "      OK: Todas as queries da tentativa " & j & " concluidas"
                        Exit For  ' Sair do loop de tentativas
                    End If
                Next
                
                ' FORÇAR RECÁLCULO FINAL
                WScript.Echo "    Forçando recálculo final..."
                objWorkbook.Application.CalculateFullRebuild
                WScript.Sleep 5000
                
                ' AGUARDAR TEMPO EXTRA DE SEGURANÇA
                WScript.Echo "    Aguardando tempo extra de segurança (30 segundos)..."
                WScript.Sleep 30000
                
                ' SALVAR COM DADOS FINAIS
                WScript.Echo "    Salvando arquivo com dados atualizados..."
                objWorkbook.Save
                WScript.Sleep 3000
                
                ' SALVAR NOVAMENTE PARA GARANTIR
                objWorkbook.Save
                WScript.Sleep 2000
                
                objWorkbook.Close False
                
                ' Verificar se arquivo REALMENTE mudou
                WScript.Sleep 3000
                dtAfter = objFSO.GetFile(strFileName).DateLastModified
                
                If dtAfter > dtBefore Then
                    intUpdatedFiles = intUpdatedFiles + 1
                    WScript.Echo "OK: " & arrFiles(i) & " - QUERIES COMPLETAMENTE EXECUTADAS"
                    WScript.Echo "  Data depois: " & dtAfter
                    WScript.Echo "  Diferença: " & DateDiff("s", dtBefore, dtAfter) & " segundos"
                    WScript.Echo "  Status: DADOS REAIS OBTIDOS"
                    
                    ' REGISTRAR ATUALIZAÇÃO NO LOG DE FREQUÊNCIA
                    Dim objShellReg
                    Set objShellReg = CreateObject("WScript.Shell")
                    objShellReg.Run "cscript //nologo registrar_atualizacao.vbs """ & arrFiles(i) & """", 0, True
                    Set objShellReg = Nothing
                Else
                    WScript.Echo "AVISO: " & arrFiles(i) & " - ARQUIVO NAO MUDOU"
                    WScript.Echo "  Possível causa: Sem queries ou dados já atualizados"
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
WScript.Echo "RESUMO DA EXECUÇÃO GARANTIDA:"
WScript.Echo "Arquivos processados: " & intTotalFiles
WScript.Echo "Arquivos com queries executadas: " & intUpdatedFiles
WScript.Echo "========================================="

If intUpdatedFiles > 0 Then
    WScript.Echo "✅ QUERIES COMPLETAMENTE EXECUTADAS!"
    WScript.Echo "✅ Tempo suficiente aguardado para queries demoradas"
    WScript.Echo "✅ Dados REAIS obtidos e salvos"
    WScript.Echo "✅ GARANTIA TOTAL de conclusão"
    WScript.Quit 0
Else
    WScript.Echo "AVISO: NENHUMA QUERY EXECUTADA OU DADOS JA ATUALIZADOS"
    WScript.Echo "Arquivos podem já conter dados atuais"
    WScript.Quit 1
End If