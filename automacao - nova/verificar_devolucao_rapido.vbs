Option Explicit

Dim objFSO, scriptPath, strArquivo, strCaminhoArquivo, strEstadoArquivo
Dim dtUltimaModificacao, dtUltimoSync
Dim hasEstado

Set objFSO = CreateObject("Scripting.FileSystemObject")
scriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
strArquivo = "DB_DEVOLUCAO.xlsx"
strCaminhoArquivo = objFSO.BuildPath(objFSO.BuildPath(scriptPath, "data"), strArquivo)
strEstadoArquivo = objFSO.BuildPath(scriptPath, "db_devolucao_last_sync.txt")

' Verificar se arquivo existe
If Not objFSO.FileExists(strCaminhoArquivo) Then
    WScript.Echo "ERRO: Arquivo não encontrado: " & strCaminhoArquivo
    WScript.Quit 1
End If

dtUltimaModificacao = objFSO.GetFile(strCaminhoArquivo).DateLastModified
hasEstado = TryReadState(strEstadoArquivo, dtUltimoSync)

WScript.Echo "Arquivo: " & strArquivo
WScript.Echo "Última modificação: " & dtUltimaModificacao

If Not hasEstado Then
    WScript.Echo "Estado local: inexistente"
    WScript.Echo "✅ DADOS PENDENTES: primeira sincronização necessária"
    WScript.Quit 0
End If

WScript.Echo "Último sync confirmado: " & dtUltimoSync

If dtUltimaModificacao > dtUltimoSync Then
    WScript.Echo "✅ DADOS NOVOS: arquivo alterado após último sync"
    WScript.Quit 0
End If

WScript.Echo "⏭️  SEM DADOS NOVOS: arquivo já sincronizado"
WScript.Quit 1

Function TryReadState(statePath, ByRef outDate)
    Dim objTextFile, rawValue

    TryReadState = False

    If Not objFSO.FileExists(statePath) Then
        Exit Function
    End If

    On Error Resume Next
    Set objTextFile = objFSO.OpenTextFile(statePath, 1, False)
    rawValue = Trim(objTextFile.ReadAll)
    objTextFile.Close

    If Err.Number <> 0 Then
        Err.Clear
        On Error GoTo 0
        Exit Function
    End If

    outDate = CDate(CDbl(rawValue))
    If Err.Number = 0 Then
        TryReadState = True
    Else
        Err.Clear
    End If
    On Error GoTo 0
End Function
