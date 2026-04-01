Option Explicit

Dim objShell, objFSO, scriptPath, batPath, batAutoPath
Dim horaInicio, horaFim, intervaloMinutos
Dim horaAtual, minutoAtual
Dim conteudo, linha, novoConteudo

' Configurações
horaInicio = 6      ' 06:00
horaFim = 20        ' 20:00
intervaloMinutos = 30

' Obter caminho do arquivo BAT
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

scriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptPath & "\AUTOMACAO_INTELIGENTE.bat"
batAutoPath = scriptPath & "\AUTOMACAO_INTELIGENTE_AUTO.bat"

' Verificar se o arquivo existe
If Not objFSO.FileExists(batPath) Then
    MsgBox "Erro: Arquivo AUTOMACAO_INTELIGENTE.bat não encontrado em:" & vbCrLf & batPath, vbCritical, "Erro"
    WScript.Quit
End If

' Criar versão sem pause
Dim arquivo, arquivoSaida
Set arquivo = objFSO.OpenTextFile(batPath, 1)
Set arquivoSaida = objFSO.CreateTextFile(batAutoPath, True)

Do Until arquivo.AtEndOfStream
    linha = arquivo.ReadLine
    ' Pular linhas com pause ou "Pressione qualquer tecla"
    If InStr(LCase(linha), "pause") = 0 And InStr(LCase(linha), "pressione qualquer tecla") = 0 Then
        arquivoSaida.WriteLine linha
    Else
        ' Substituir pause por exit
        If InStr(LCase(linha), "pause") > 0 Then
            arquivoSaida.WriteLine "exit /b 0"
        End If
    End If
Loop

arquivo.Close
arquivoSaida.Close

' Loop infinito
Do While True
    horaAtual = Hour(Now)
    minutoAtual = Minute(Now)
    
    ' Verificar se está dentro do horário permitido
    If horaAtual >= horaInicio And horaAtual < horaFim Then
        ' Executar o arquivo BAT modificado
        objShell.Run """" & batAutoPath & """", 1, True
        
        ' Aguardar 30 minutos (1800000 milissegundos)
        WScript.Sleep 1800000
    Else
        ' Fora do horário, verificar a cada 5 minutos
        WScript.Sleep 300000
    End If
Loop
