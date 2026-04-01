Option Explicit

Dim objShell, objFSO, scriptPath, vbsPath

Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

scriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
vbsPath = scriptPath & "\executar_automacao_20min_v2.vbs"

' Executar o script em modo invisível (janela oculta)
objShell.Run "cscript //nologo """ & vbsPath & """", 0, False

MsgBox "Automação iniciada em segundo plano!" & vbCrLf & vbCrLf & _
       "Horário: 06:00 às 20:00" & vbCrLf & _
       "Intervalo: 30 minutos" & vbCrLf & _
       "DB_DEVOLUCAO: Monitor dedicado de 5min (inicie separadamente)" & vbCrLf & vbCrLf & _
       "Para parar, finalize o processo 'cscript.exe' no Gerenciador de Tarefas", _
       vbInformation, "Automação Ativa"
