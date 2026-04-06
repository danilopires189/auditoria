Option Explicit

Dim objFSO, objFile, strDataFolder, arrFiles, i
Dim dtNow, dtFileModified, intMinutesOld
Dim blnAllFilesRecent, intRecentFiles, intTotalFiles

' Configurações
strDataFolder = "data"
intRecentFiles = 0
intTotalFiles = 0
blnAllFilesRecent = True

' Lista de arquivos Excel para verificar
arrFiles = Array("BD_AVULSO.xlsx", "BD_END.xlsx", "BD_ROTAS.xlsx", "DB_BARRAS.xlsx", _
                 "DB_DEVOLUCAO.xlsx", "DB_ENTRADA_NOTAS.xlsx", "DB_ESTQ_ENTR.xlsx", _
                 "DB_LOG_END.xlsx", "DB_PEDIDO_DIRETO.xlsx", "DB_PROD_BLITZ.xlsx", _
                 "DB_PROD_VOL.xlsx", "DB_GESTAO_ESTQ.xlsx", "DB_TERMO.xlsx", "DB_USUARIO.xlsx", "DB_BLITZ.xlsx")

Set objFSO = CreateObject("Scripting.FileSystemObject")
dtNow = Now()

WScript.Echo "Verificando se os arquivos Excel foram atualizados recentemente..."
WScript.Echo "Hora atual: " & dtNow
WScript.Echo ""

' Verificar cada arquivo
For i = 0 To UBound(arrFiles)
    Dim strFileName
    strFileName = objFSO.BuildPath(strDataFolder, arrFiles(i))
    
    If objFSO.FileExists(strFileName) Then
        intTotalFiles = intTotalFiles + 1
        Set objFile = objFSO.GetFile(strFileName)
        dtFileModified = objFile.DateLastModified
        
        ' Calcular diferença em minutos
        intMinutesOld = DateDiff("n", dtFileModified, dtNow)
        
        WScript.Echo arrFiles(i) & ":"
        WScript.Echo "  Última modificação: " & dtFileModified
        WScript.Echo "  Idade: " & intMinutesOld & " minutos"
        
        ' Considerar arquivo recente se foi modificado nos últimos 10 minutos
        If intMinutesOld <= 10 Then
            WScript.Echo "  Status: ✓ RECENTE"
            intRecentFiles = intRecentFiles + 1
        Else
            WScript.Echo "  Status: ✗ ANTIGO (mais de 10 minutos)"
            blnAllFilesRecent = False
        End If
        
        Set objFile = Nothing
    Else
        WScript.Echo arrFiles(i) & ": ⚠ ARQUIVO NÃO ENCONTRADO"
        blnAllFilesRecent = False
    End If
    WScript.Echo ""
Next

Set objFSO = Nothing

WScript.Echo "========================================="
WScript.Echo "RESUMO DA VERIFICAÇÃO:"
WScript.Echo "Arquivos verificados: " & intTotalFiles
WScript.Echo "Arquivos recentes: " & intRecentFiles
WScript.Echo "========================================="

If blnAllFilesRecent And intRecentFiles > 0 Then
    WScript.Echo "✓ Todos os arquivos parecem ter sido atualizados recentemente"
    WScript.Quit 0
Else
    WScript.Echo "✗ Alguns arquivos podem não ter sido atualizados"
    WScript.Quit 1
End If
