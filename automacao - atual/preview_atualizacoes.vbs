Option Explicit

Dim objFSO, objShell, arrFiles, i, intArquivosParaAtualizar, intArquivosPulados
Dim strArquivo, intResultCheck

Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

' Lista de arquivos Excel
arrFiles = Array("BD_AVULSO.xlsx", "BD_END.xlsx", "BD_ROTAS.xlsx", "DB_BARRAS.xlsx", _
                 "DB_DEVOLUCAO.xlsx", "DB_ENTRADA_NOTAS.xlsx", "DB_ESTQ_ENTR.xlsx", _
                 "DB_LOG_END.xlsx", "DB_PEDIDO_DIRETO.xlsx", "DB_PROD_BLITZ.xlsx", _
                 "DB_PROD_VOL.xlsx", "DB_TERMO.xlsx", "DB_USUARIO.xlsx")

intArquivosParaAtualizar = 0
intArquivosPulados = 0

WScript.Echo "========================================="
WScript.Echo "PREVIEW - ARQUIVOS QUE SERÃO PROCESSADOS"
WScript.Echo "========================================="
WScript.Echo ""

WScript.Echo "🔍 VERIFICANDO FREQUÊNCIA DE CADA ARQUIVO:"
WScript.Echo ""

For i = 0 To UBound(arrFiles)
    strArquivo = arrFiles(i)
    
    ' Verificar se arquivo precisa ser atualizado
    intResultCheck = objShell.Run("cscript //nologo verificar_frequencia.vbs """ & strArquivo & """", 0, True)
    
    If intResultCheck = 0 Then
        ' Arquivo precisa ser atualizado
        intArquivosParaAtualizar = intArquivosParaAtualizar + 1
        If InStr(strArquivo, "DB_ENTRADA_NOTAS") > 0 Or InStr(strArquivo, "DB_DEVOLUCAO") > 0 Then
            WScript.Echo "✅ SERÁ PROCESSADO: " & strArquivo & " (30min)"
        Else
            WScript.Echo "✅ SERÁ PROCESSADO: " & strArquivo
        End If
    ElseIf intResultCheck = 2 Then
        ' Arquivo não precisa ser atualizado
        intArquivosPulados = intArquivosPulados + 1
        WScript.Echo "⏭️  SERÁ PULADO: " & strArquivo & " (ainda no intervalo)"
    Else
        ' Erro na verificação
        WScript.Echo "❓ ERRO NA VERIFICAÇÃO: " & strArquivo
    End If
Next

WScript.Echo ""
WScript.Echo "========================================="
WScript.Echo "RESUMO DO PREVIEW:"
WScript.Echo "Arquivos que SERÃO processados: " & intArquivosParaAtualizar
WScript.Echo "Arquivos que serão PULADOS: " & intArquivosPulados
WScript.Echo "========================================="

If intArquivosParaAtualizar > 0 Then
    WScript.Echo ""
    WScript.Echo "🚀 EXECUÇÃO RECOMENDADA:"
    WScript.Echo "✅ " & intArquivosParaAtualizar & " arquivo(s) precisam ser atualizados"
    WScript.Echo "✅ Sincronização com Supabase será executada"
    WScript.Echo "⏱️  Tempo estimado: " & (intArquivosParaAtualizar * 2) & "-" & (intArquivosParaAtualizar * 5) & " minutos"
    WScript.Quit 0
Else
    WScript.Echo ""
    WScript.Echo "⏸️  EXECUÇÃO DESNECESSÁRIA:"
    WScript.Echo "⏭️  Todos os arquivos estão dentro dos intervalos de frequência"
    WScript.Echo "⏭️  Sincronização com Supabase será pulada"
    WScript.Echo "💡 Execute VER_STATUS_FREQUENCIA.bat para ver detalhes"
    WScript.Quit 1
End If

Set objFSO = Nothing
Set objShell = Nothing