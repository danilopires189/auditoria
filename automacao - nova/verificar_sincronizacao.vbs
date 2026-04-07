Option Explicit

Dim objFSO, objFile, strDataFolder, arrFiles, i
Dim dtNow, dtFileModified, intMinutesOld
Dim intRecentFiles, intTotalFiles, intVeryRecentFiles

' Configurações
strDataFolder = "data"
intRecentFiles = 0
intVeryRecentFiles = 0
intTotalFiles = 0

' Lista de arquivos Excel para verificar
arrFiles = Array("BD_AVULSO.xlsx", "BD_END.xlsx", "BD_ROTAS.xlsx", "DB_BARRAS.xlsx", _
                 "DB_DEVOLUCAO.xlsx", "DB_ENTRADA_NOTAS.xlsx", "DB_ATENDIMENTO.xlsx", "DB_ESTQ_ENTR.xlsx", _
                 "DB_LOG_END.xlsx", "DB_PEDIDO_DIRETO.xlsx", "DB_PROD_BLITZ.xlsx", _
                 "DB_PROD_VOL.xlsx", "DB_GESTAO_ESTQ.xlsx", "DB_TERMO.xlsx", "DB_USUARIO.xlsx", "DB_BLITZ.xlsx")

Set objFSO = CreateObject("Scripting.FileSystemObject")
dtNow = Now()

WScript.Echo "========================================="
WScript.Echo "VERIFICAÇÃO PÓS-SINCRONIZAÇÃO"
WScript.Echo "========================================="
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
        
        ' Classificar por idade
        If intMinutesOld <= 5 Then
            WScript.Echo "  Status: ✓ MUITO RECENTE (≤5 min) - PERFEITO!"
            intVeryRecentFiles = intVeryRecentFiles + 1
            intRecentFiles = intRecentFiles + 1
        ElseIf intMinutesOld <= 15 Then
            WScript.Echo "  Status: ✓ RECENTE (≤15 min) - BOM"
            intRecentFiles = intRecentFiles + 1
        ElseIf intMinutesOld <= 60 Then
            WScript.Echo "  Status: ⚠ MODERADO (≤60 min) - ACEITÁVEL"
        Else
            WScript.Echo "  Status: ✗ ANTIGO (>60 min) - PROBLEMA!"
        End If
        
        Set objFile = Nothing
    Else
        WScript.Echo arrFiles(i) & ": ⚠ ARQUIVO NÃO ENCONTRADO"
    End If
    WScript.Echo ""
Next

Set objFSO = Nothing

WScript.Echo "========================================="
WScript.Echo "RELATÓRIO DE ATUALIZAÇÃO:"
WScript.Echo "Arquivos verificados: " & intTotalFiles
WScript.Echo "Muito recentes (≤5 min): " & intVeryRecentFiles
WScript.Echo "Recentes (≤15 min): " & intRecentFiles
WScript.Echo "========================================="

' Determinar resultado
If intVeryRecentFiles >= (intTotalFiles * 0.8) Then
    WScript.Echo "🎯 EXCELENTE: " & intVeryRecentFiles & " de " & intTotalFiles & " arquivos muito recentes!"
    WScript.Echo "✅ Queries foram atualizadas com sucesso"
    WScript.Echo "✅ Dados no Supabase devem estar atualizados"
    WScript.Quit 0
ElseIf intRecentFiles >= (intTotalFiles * 0.7) Then
    WScript.Echo "👍 BOM: " & intRecentFiles & " de " & intTotalFiles & " arquivos recentes"
    WScript.Echo "✅ Maioria das queries foi atualizada"
    WScript.Echo "⚠️  Alguns dados podem estar um pouco desatualizados"
    WScript.Quit 0
Else
    WScript.Echo "⚠️  ATENÇÃO: Poucos arquivos foram atualizados recentemente"
    WScript.Echo "❌ Queries podem não ter sido atualizadas corretamente"
    WScript.Echo "💡 Recomendação: Execute a automação novamente"
    WScript.Quit 1
End If
