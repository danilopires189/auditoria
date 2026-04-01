Option Explicit

Dim objFSO, strArquivo, dtAgora, dtUltimaModificacao
Dim intMinutosDecorridos, strCaminhoArquivo

Set objFSO = CreateObject("Scripting.FileSystemObject")
strArquivo = "DB_DEVOLUCAO.xlsx"
strCaminhoArquivo = "data\" & strArquivo

' Verificar se arquivo existe
If Not objFSO.FileExists(strCaminhoArquivo) Then
    WScript.Echo "ERRO: Arquivo não encontrado: " & strCaminhoArquivo
    WScript.Quit 1
End If

' Obter datas
dtAgora = Now()
dtUltimaModificacao = objFSO.GetFile(strCaminhoArquivo).DateLastModified
intMinutosDecorridos = DateDiff("n", dtUltimaModificacao, dtAgora)

WScript.Echo "Arquivo: " & strArquivo
WScript.Echo "Última modificação: " & dtUltimaModificacao
WScript.Echo "Minutos desde modificação: " & intMinutosDecorridos

' Se foi modificado nos últimos 5 minutos, precisa sincronizar
If intMinutosDecorridos <= 5 Then
    WScript.Echo "✅ DADOS NOVOS: Arquivo modificado há " & intMinutosDecorridos & " minutos"
    WScript.Quit 0  ' Código 0 = tem dados novos
Else
    WScript.Echo "⏭️  SEM DADOS NOVOS: Última modificação há " & intMinutosDecorridos & " minutos"
    WScript.Quit 1  ' Código 1 = sem dados novos
End If