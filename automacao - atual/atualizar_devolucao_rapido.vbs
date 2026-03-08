Option Explicit

Dim objExcel, objWorkbook, objFSO
Dim strDataFolder, strArquivo, strCaminhoCompleto
Dim dtBefore, dtAfter, intRowCountBefore, intRowCountAfter
Dim blnQueryStillActive, intStableChecks, intMaxStableChecks

' Configurações
Set objFSO = CreateObject("Scripting.FileSystemObject")
strDataFolder = objFSO.BuildPath(objFSO.GetAbsolutePathName("."), "data")
strArquivo = "DB_DEVOLUCAO.xlsx"
strCaminhoCompleto = objFSO.BuildPath(strDataFolder, strArquivo)
intMaxStableChecks = 3  ' Menos verificações para ser mais rápido

WScript.Echo "========================================="
WScript.Echo "ATUALIZAÇÃO RÁPIDA - DB_DEVOLUCAO"
WScript.Echo "========================================="
WScript.Echo "Arquivo: " & strArquivo
WScript.Echo "Caminho: " & strCaminhoCompleto

' Verificar se arquivo existe
If Not objFSO.FileExists(strCaminhoCompleto) Then
    WScript.Echo "ERRO: Arquivo não encontrado: " & strCaminhoCompleto
    WScript.Quit 1
End If

' Inicializar Excel
On Error Resume Next
Set objExcel = GetObject(, "Excel.Application")
If Err.Number <> 0 Then
    Err.Clear
    Set objExcel = CreateObject("Excel.Application")
    If Err.Number <> 0 Then
        WScript.Echo "ERRO: Não foi possível inicializar o Excel"
        WScript.Quit 1
    End If
End If
On Error GoTo 0

' Configurar Excel para modo silencioso
objExcel.Visible = False
objExcel.DisplayAlerts = False
objExcel.AskToUpdateLinks = True
objExcel.AlertBeforeOverwriting = False
objExcel.EnableEvents = True

WScript.Echo "Excel inicializado em modo silencioso"

' Abrir arquivo
On Error Resume Next
Set objWorkbook = objExcel.Workbooks.Open(strCaminhoCompleto)
If Err.Number <> 0 Then
    WScript.Echo "ERRO: Não foi possível abrir o arquivo: " & Err.Description
    objExcel.Quit
    WScript.Quit 1
End If
On Error GoTo 0

WScript.Echo "Arquivo aberto: " & strArquivo

' Contar linhas antes
dtBefore = Now()
intRowCountBefore = objWorkbook.Worksheets("DB_DEVOLUCAO").UsedRange.Rows.Count - 1
WScript.Echo "Linhas antes: " & intRowCountBefore
WScript.Echo "Iniciando atualização das queries..."

' Atualizar todas as conexões
objWorkbook.RefreshAll

' Monitorar até estabilizar
intStableChecks = 0
blnQueryStillActive = True

WScript.Echo "Monitorando progresso..."

Do While blnQueryStillActive And intStableChecks < intMaxStableChecks
    WScript.Sleep 2000  ' Aguardar 2 segundos
    
    ' Verificar se ainda há queries ativas
    If objExcel.CalculationState = -4143 Then ' xlCalculationAutomatic
        intRowCountAfter = objWorkbook.Worksheets("DB_DEVOLUCAO").UsedRange.Rows.Count - 1
        
        If intRowCountAfter = intRowCountBefore Then
            intStableChecks = intStableChecks + 1
            WScript.Echo "[" & intStableChecks & "/" & intMaxStableChecks & "] Dados estáveis: " & intRowCountAfter & " linhas"
        Else
            intStableChecks = 0
            WScript.Echo "Dados chegando: " & intRowCountBefore & " → " & intRowCountAfter & " linhas"
            intRowCountBefore = intRowCountAfter
        End If
    Else
        intStableChecks = 0
        WScript.Echo "Queries ainda ativas..."
    End If
Loop

' Resultado final
dtAfter = Now()
intRowCountAfter = objWorkbook.Worksheets("DB_DEVOLUCAO").UsedRange.Rows.Count - 1

WScript.Echo "========================================="
WScript.Echo "RESULTADO:"
WScript.Echo "Linhas antes: " & intRowCountBefore
WScript.Echo "Linhas depois: " & intRowCountAfter
WScript.Echo "Diferença: " & (intRowCountAfter - intRowCountBefore)
WScript.Echo "Tempo: " & DateDiff("s", dtBefore, dtAfter) & " segundos"

' Salvar e fechar
objWorkbook.Save
objWorkbook.Close
objExcel.Quit

WScript.Echo "✅ DB_DEVOLUCAO atualizado com sucesso!"
WScript.Quit 0