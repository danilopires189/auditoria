Option Explicit

Dim objShell, objFSO, scriptPath
Dim horaInicio, horaFim, intervaloMinutos, intervaloStandby
Dim horaAtual
Dim resultado, strArquivoMonitorado, strCaminhoArquivo, strEstadoArquivo
Dim dtUltimaModificacao, dtModificacaoProcessada, dtModificacaoAtual

' Configurações
horaInicio = 6          ' 06:00
horaFim = 20           ' 20:00
intervaloMinutos = 1   ' 1 minuto durante horário ativo
intervaloStandby = 5   ' 5 minutos durante standby

' Obter objetos
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")
scriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
strArquivoMonitorado = "DB_DEVOLUCAO.xlsx"
strCaminhoArquivo = objFSO.BuildPath(objFSO.BuildPath(scriptPath, "data"), strArquivoMonitorado)
strEstadoArquivo = objFSO.BuildPath(scriptPath, "db_devolucao_last_sync.txt")

' Verificar se os arquivos necessários existem
If Not objFSO.FileExists(scriptPath & "\verificar_devolucao_rapido.vbs") Then
    MsgBox "Erro: Arquivo verificar_devolucao_rapido.vbs não encontrado!", vbCritical, "Erro"
    WScript.Quit
End If

If Not objFSO.FileExists(scriptPath & "\atualizar_devolucao_rapido.vbs") Then
    MsgBox "Erro: Arquivo atualizar_devolucao_rapido.vbs não encontrado!", vbCritical, "Erro"
    WScript.Quit
End If

If Not objFSO.FileExists(strCaminhoArquivo) Then
    MsgBox "Erro: Arquivo " & strArquivoMonitorado & " não encontrado em data\", vbCritical, "Erro"
    WScript.Quit
End If

WScript.Echo "=========================================="
WScript.Echo "  MONITOR DB_DEVOLUCAO COM CONTROLE DE HORÁRIO"
WScript.Echo "=========================================="
WScript.Echo "Horário de funcionamento: " & horaInicio & ":00 às " & horaFim & ":00"
WScript.Echo "Intervalo ativo: " & intervaloMinutos & " minutos"
WScript.Echo "Standby fora do horário: " & intervaloStandby & " minutos"
WScript.Echo "Iniciando monitoramento..."
WScript.Echo ""

' Loop infinito
Do While True
    horaAtual = Hour(Now)
    
    ' Verificar se está dentro do horário permitido
    If horaAtual >= horaInicio And horaAtual < horaFim Then
        WScript.Echo "[" & FormatDateTime(Now, 4) & "] Verificando DB_DEVOLUCAO..."
        
        ' Verificar se há dados novos
        resultado = objShell.Run("cscript //NoLogo """ & scriptPath & "\verificar_devolucao_rapido.vbs""", 0, True)
        
        If resultado = 0 Then
            WScript.Echo "✅ Dados novos detectados! Sincronizando..."
            dtModificacaoProcessada = objFSO.GetFile(strCaminhoArquivo).DateLastModified
            
            ' Executar query apenas do DB_DEVOLUCAO
            resultado = objShell.Run("cscript //NoLogo """ & scriptPath & "\atualizar_devolucao_rapido.vbs""", 0, True)
            
            If resultado = 0 Then
                WScript.Echo "✅ Query executada com sucesso!"
                
                ' Sincronizar apenas DB_DEVOLUCAO no Supabase
                WScript.Echo "Sincronizando DB_DEVOLUCAO no Supabase..."
                resultado = objShell.Run("cmd /c """ & scriptPath & "\sync_backend_cli_runner.bat"" sync --table db_devolucao", 0, True)
                
                If resultado = 0 Then
                    dtModificacaoAtual = objFSO.GetFile(strCaminhoArquivo).DateLastModified
                    dtUltimaModificacao = dtModificacaoProcessada

                    If dtModificacaoAtual > dtModificacaoProcessada Then
                        WScript.Echo "⚠️  Arquivo mudou durante o sync; novo ciclo será necessário"
                    End If

                    If SaveState(strEstadoArquivo, dtUltimaModificacao) Then
                        WScript.Echo "Estado atualizado para: " & dtUltimaModificacao
                    Else
                        WScript.Echo "⚠️  Não foi possível salvar estado local; nova tentativa ocorrerá no próximo ciclo"
                    End If
                    WScript.Echo "✅ DB_DEVOLUCAO sincronizado com sucesso!"
                Else
                    WScript.Echo "⚠️  Erro na sincronização, tentando novamente em " & intervaloMinutos & " min"
                End If
            Else
                WScript.Echo "❌ Erro na atualização, tentando novamente em " & intervaloMinutos & " min"
            End If
        Else
            WScript.Echo "⏭️  Sem dados novos, aguardando..."
        End If
        
        ' Aguardar intervalo ativo
        WScript.Echo "[" & FormatDateTime(Now, 4) & "] Aguardando " & intervaloMinutos & " minutos..."
        WScript.Sleep intervaloMinutos * 60000
        
    Else
        ' Fora do horário - modo standby
        WScript.Echo "[" & FormatDateTime(Now, 4) & "] Fora do horário (" & horaInicio & "h-" & horaFim & "h) - Standby..."
        
        ' Aguardar intervalo standby
        WScript.Sleep intervaloStandby * 60000
    End If
Loop

Function SaveState(statePath, stateDate)
    Dim objTextFile

    SaveState = False

    On Error Resume Next
    Set objTextFile = objFSO.OpenTextFile(statePath, 2, True)
    objTextFile.Write CStr(CDbl(stateDate))
    objTextFile.Close

    If Err.Number = 0 Then
        SaveState = True
    Else
        Err.Clear
    End If
    On Error GoTo 0
End Function
