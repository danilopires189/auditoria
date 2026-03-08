Option Explicit

Dim objFSO, strArquivo, strLogFile, strLogContent, dtAgora
Dim objFile

' Parâmetro: nome do arquivo que foi atualizado
If WScript.Arguments.Count = 0 Then
    WScript.Echo "ERRO: Informe o nome do arquivo que foi atualizado"
    WScript.Quit 1
End If

strArquivo = WScript.Arguments(0)
Set objFSO = CreateObject("Scripting.FileSystemObject")
strLogFile = "logs\ultima_atualizacao.log"
dtAgora = Now()

' Criar pasta logs se não existir
If Not objFSO.FolderExists("logs") Then
    objFSO.CreateFolder("logs")
End If

' Registrar atualização no log
Set objFile = objFSO.OpenTextFile(strLogFile, 8, True)  ' 8 = ForAppending, True = Create if not exists
objFile.WriteLine(Year(dtAgora) & "-" & Right("0" & Month(dtAgora), 2) & "-" & Right("0" & Day(dtAgora), 2) & " " & _
                  Right("0" & Hour(dtAgora), 2) & ":" & Right("0" & Minute(dtAgora), 2) & ":" & Right("0" & Second(dtAgora), 2) & " - " & strArquivo)
objFile.Close

WScript.Echo "REGISTRADO: " & strArquivo & " atualizado em " & dtAgora

Set objFile = Nothing
Set objFSO = Nothing