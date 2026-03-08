Option Explicit

Dim objShell, objFSO, scriptPath, batPath
Dim horaInicio, horaFim, intervaloMinutos
Dim horaAtual, minutoAtual

' Configurações
horaInicio = 6      ' 06:00
horaFim = 20        ' 20:00
intervaloMinutos = 30

' Obter caminho do arquivo BAT
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

scriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptPath & "\AUTOMACAO_INTELIGENTE.bat"

' Verificar se o arquivo existe
If Not objFSO.FileExists(batPath) Then
    MsgBox "Erro: Arquivo AUTOMACAO_INTELIGENTE.bat não encontrado em:" & vbCrLf & batPath, vbCritical, "Erro"
    WScript.Quit
End If

' Loop infinito
Do While True
    horaAtual = Hour(Now)
    minutoAtual = Minute(Now)
    
    ' Verificar se está dentro do horário permitido
    If horaAtual >= horaInicio And horaAtual < horaFim Then
        ' Executar o arquivo BAT e forçar fechamento após 2 minutos se não fechar
        Dim processo
        Set processo = objShell.Exec("cmd /c """ & batPath & """")
        
        ' Aguardar até 2 minutos para o processo terminar
        Dim contador
        contador = 0
        Do While processo.Status = 0 And contador < 120
            WScript.Sleep 1000  ' 1 segundo
            contador = contador + 1
        Loop
        
        ' Se ainda estiver rodando após 2 minutos, forçar fechamento
        If processo.Status = 0 Then
            objShell.Run "taskkill /F /IM cmd.exe /FI ""WINDOWTITLE eq *AUTOMACAO_INTELIGENTE*""", 0, False
        End If
        
        ' Aguardar 30 minutos (1800000 milissegundos)
        WScript.Sleep 1800000
    Else
        ' Fora do horário, verificar a cada 5 minutos
        WScript.Sleep 300000
    End If
Loop
