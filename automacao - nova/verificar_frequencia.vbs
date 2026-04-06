Option Explicit

Dim objFSO, strConfigFile, strContent
Dim strArquivo, dtAgora, dtUltimaAtualizacao, intIntervaloMinutos
Dim blnPrecisaAtualizar, strGrupo, strCaminhoArquivo, dtModificacaoArquivo

' Parâmetro: nome do arquivo a verificar
If WScript.Arguments.Count = 0 Then
    WScript.Echo "ERRO: Informe o nome do arquivo para verificar"
    WScript.Quit 1
End If

strArquivo = WScript.Arguments(0)
Set objFSO = CreateObject("Scripting.FileSystemObject")
strConfigFile = "frequencia_atualizacao.json"

' Verificar se arquivo de configuração existe
If Not objFSO.FileExists(strConfigFile) Then
    WScript.Echo "ERRO: Arquivo de configuração não encontrado: " & strConfigFile
    WScript.Quit 1
End If

' Definir caminho completo do arquivo Excel
strCaminhoArquivo = "data\" & strArquivo
If Not objFSO.FileExists(strCaminhoArquivo) Then
    WScript.Echo "ERRO: Arquivo não encontrado: " & strCaminhoArquivo
    WScript.Quit 1
End If

' Obter data de modificação do arquivo Excel
dtModificacaoArquivo = objFSO.GetFile(strCaminhoArquivo).DateLastModified
dtAgora = Now()
blnPrecisaAtualizar = True
intIntervaloMinutos = 15  ' Padrão: 15 minutos

' Determinar intervalo baseado no arquivo e suas regras específicas
' GRUPO 1: A CADA 30 MINUTOS (arquivos críticos)
If InStr(UCase(strArquivo), "DB_ENTRADA_NOTAS") > 0 Then
    intIntervaloMinutos = 30  ' 30 minutos

' GRUPO 1.5: DB_DEVOLUCAO - CONTROLADO POR MONITOR SEPARADO
ElseIf InStr(UCase(strArquivo), "DB_DEVOLUCAO") > 0 Then
    ' DB_DEVOLUCAO é controlado pelo monitor de 5 minutos separado
    ' No fluxo principal, atualiza apenas 1x por hora para não conflitar
    intIntervaloMinutos = 60  ' 1 hora no fluxo principal

' GRUPO 2: 1 VEZ POR DIA (verifica se já atualizou hoje)
ElseIf InStr(UCase(strArquivo), "DB_BARRAS") > 0 Or _
       InStr(UCase(strArquivo), "BD_AVULSO") > 0 Or _
       InStr(UCase(strArquivo), "BD_ROTAS") > 0 Or _
       InStr(UCase(strArquivo), "DB_LOG_END") > 0 Or _
       InStr(UCase(strArquivo), "DB_USUARIO") > 0 Or _
       InStr(UCase(strArquivo), "DB_PROD_VOL") > 0 Or _
       InStr(UCase(strArquivo), "DB_GESTAO_ESTQ") > 0 Then
    
    ' Verificar se já foi atualizado hoje
    Dim dtHoje, dtUltimaModificacao
    dtHoje = Date()  ' Data de hoje (sem hora)
    dtUltimaModificacao = DateValue(dtModificacaoArquivo)  ' Data da última modificação (sem hora)
    
    If dtUltimaModificacao >= dtHoje Then
        ' Já foi atualizado hoje
        WScript.Echo "SKIP: " & strArquivo & " - Já foi atualizado hoje (" & dtUltimaModificacao & ")"
        WScript.Echo "Grupo: 1_vez_por_dia"
        WScript.Echo "Próxima atualização: amanhã"
        WScript.Quit 2  ' Código 2 = não precisa atualizar
    Else
        ' Não foi atualizado hoje, precisa atualizar
        WScript.Echo "ATUALIZAR: " & strArquivo & " - Grupo: 1_vez_por_dia (não atualizou hoje)"
        WScript.Echo "Última atualização: " & dtUltimaModificacao
        WScript.Echo "Data atual: " & dtHoje
        WScript.Quit 0  ' Código 0 = precisa atualizar
    End If

' GRUPO 3: A CADA 6 HORAS (360 minutos)
ElseIf InStr(UCase(strArquivo), "BD_END") > 0 Then
    intIntervaloMinutos = 360   ' 6 horas
    strGrupo = "a_cada_6_horas"

' GRUPO 4: A CADA 1 HORA (60 minutos)
ElseIf InStr(UCase(strArquivo), "DB_TERMO") > 0 Or _
       InStr(UCase(strArquivo), "DB_PEDIDO_DIRETO") > 0 Or _
       InStr(UCase(strArquivo), "DB_PROD_BLITZ") > 0 Or _
       InStr(UCase(strArquivo), "DB_ESTQ_ENTR") > 0 Then
    intIntervaloMinutos = 60    ' 1 hora
    strGrupo = "a_cada_1_hora"
End If

' Verificar se precisa atualizar baseado na data de salvamento do arquivo
Dim intMinutosDecorridos
intMinutosDecorridos = DateDiff("n", dtModificacaoArquivo, dtAgora)

' Verificar se o arquivo foi modificado dentro do intervalo permitido
If intMinutosDecorridos < intIntervaloMinutos Then
    blnPrecisaAtualizar = False
    WScript.Echo "SKIP: " & strArquivo & " - Modificado há " & intMinutosDecorridos & " min (intervalo: " & intIntervaloMinutos & " min)"
    WScript.Echo "Grupo: " & strGrupo
    WScript.Echo "Data modificação arquivo: " & dtModificacaoArquivo
    WScript.Echo "Próxima atualização em: " & DateAdd("n", intIntervaloMinutos - intMinutosDecorridos, dtAgora)
    WScript.Quit 2  ' Código 2 = não precisa atualizar
End If

' Se chegou aqui, precisa atualizar
WScript.Echo "ATUALIZAR: " & strArquivo & " - Grupo: " & strGrupo & " (intervalo: " & intIntervaloMinutos & " min)"
WScript.Echo "Data modificação arquivo: " & dtModificacaoArquivo
WScript.Echo "Minutos desde última modificação: " & intMinutosDecorridos
WScript.Quit 0  ' Código 0 = precisa atualizar
