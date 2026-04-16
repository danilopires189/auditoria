Option Explicit

Dim objShell, objFSO, scriptPath
Dim horaInicio, horaFim, intervaloMinutos, intervaloStandby
Dim horaAtual, minutoAtual
Dim resultado

' Configurações
horaInicio = 6          ' 06:00
horaFim = 20           ' 20:00
intervaloMinutos = 5   ' 5 minutos durante horário ativo
intervaloStandby = 5   ' 5 minutos durante standby

' Obter objetos
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")
scriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Verificar se os arquivos necessários existem
If Not objFSO.FileExists(scriptPath & "\verificar_devolucao_rapido.vbs") Then
    MsgBox "Erro: Arquivo verificar_devolucao_rapido.vbs não encontrado!", vbCritical, "Erro"
    WScript.Quit
End If

If Not objFSO.FileExists(scriptPath & "\atualizar_devolucao_rapido.vbs") Then
    MsgBox "Erro: Arquivo atualizar_devolucao_rapido.vbs não encontrado!", vbCritical, "Erro"
    WScript.Quit
End If

WScript.Echo "=========================================="
WScript.Echo "  MONITOR DB_DEVOLUCAO COM CONTROLE DE HORÁRIO"
WScript.Echo "=========================================="
WScript.Echo "Horário de funcionamento: " & horaInicio & ":00 às " & horaFim & ":00"
WScript.Echo "Intervalo ativo: " & intervaloMinutos & " minutos"
WScript.Echo "Iniciando monitoramento..."
WScript.Echo ""

' Loop infinito
Do While True
    horaAtual = Hour(Now)
    minutoAtual = Minute(Now)
    
    ' Verificar se está dentro do horário permitido
    If horaAtual >= horaInicio And horaAtual < horaFim Then
        WScript.Echo "[" & FormatDateTime(Now, 4) & "] Verificando DB_DEVOLUCAO..."
        
        ' Verificar se há dados novos
        resultado = objShell.Run("cscript //NoLogo """ & scriptPath & "\verificar_devolucao_rapido.vbs""", 0, True)
        
        If resultado = 0 Then
            WScript.Echo "✅ Dados novos detectados! Sincronizando..."
            
            ' Executar query apenas do DB_DEVOLUCAO
            resultado = objShell.Run("cscript //NoLogo """ & scriptPath & "\atualizar_devolucao_rapido.vbs""", 0, True)
            
            If resultado = 0 Then
                WScript.Echo "✅ Query executada com sucesso!"
                
                ' Sincronizar apenas DB_DEVOLUCAO no Supabase
                WScript.Echo "Sincronizando DB_DEVOLUCAO no Supabase..."
                resultado = objShell.Run("cmd /c """ & scriptPath & "\sync_backend_cli_runner.bat"" sync --table db_devolucao", 0, True)
                
                If resultado = 0 Then
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
        
        ' Aguardar intervalo ativo (5 minutos = 300000 milissegundos)
        WScript.Echo "[" & FormatDateTime(Now, 4) & "] Aguardando " & intervaloMinutos & " minutos..."
        WScript.Sleep intervaloMinutos * 60000
        
    Else
        ' Fora do horário - modo standby
        WScript.Echo "[" & FormatDateTime(Now, 4) & "] Fora do horário (" & horaInicio & "h-" & horaFim & "h) - Standby..."
        
        ' Aguardar intervalo standby (5 minutos = 300000 milissegundos)
        WScript.Sleep intervaloStandby * 60000
    End If
Loop
