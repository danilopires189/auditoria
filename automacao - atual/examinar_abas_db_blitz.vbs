Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objFile = objFSO.CreateTextFile("resultado_db_blitz.txt", True)

Set objExcel = CreateObject("Excel.Application")
objExcel.Visible = False
objExcel.DisplayAlerts = False

Set objWorkbook = objExcel.Workbooks.Open(objFSO.GetAbsolutePathName("data\DB_BLITZ.xlsx"))

objFile.WriteLine "=== EXAMINANDO DB_BLITZ.xlsx ==="
objFile.WriteLine ""
objFile.WriteLine "Abas encontradas: " & objWorkbook.Worksheets.Count

For i = 1 To objWorkbook.Worksheets.Count
    Set objWorksheet = objWorkbook.Worksheets(i)
    objFile.WriteLine i & ". " & objWorksheet.Name
    
    ' Contar linhas e colunas com dados
    Set objUsedRange = objWorksheet.UsedRange
    If Not objUsedRange Is Nothing Then
        objFile.WriteLine "   Linhas: " & objUsedRange.Rows.Count
        objFile.WriteLine "   Colunas: " & objUsedRange.Columns.Count
        
        ' Mostrar nomes das colunas (primeira linha)
        objFile.WriteLine "   Colunas:"
        For j = 1 To objUsedRange.Columns.Count
            If objUsedRange.Cells(1, j).Value <> "" Then
                objFile.WriteLine "     - " & objUsedRange.Cells(1, j).Value
            End If
        Next
        
        ' Mostrar algumas linhas de exemplo
        objFile.WriteLine "   Primeiras 3 linhas de dados:"
        For row = 2 To 4 ' Pular cabeçalho e mostrar 3 linhas
            If row <= objUsedRange.Rows.Count Then
                strLinha = "     "
                For col = 1 To objUsedRange.Columns.Count
                    If col <= 5 Then ' Mostrar apenas primeiras 5 colunas
                        strLinha = strLinha & objUsedRange.Cells(row, col).Value & " | "
                    End If
                Next
                objFile.WriteLine strLinha
            End If
        Next
    End If
    objFile.WriteLine ""
Next

objWorkbook.Close False
objExcel.Quit

Set objWorksheet = Nothing
Set objWorkbook = Nothing
Set objExcel = Nothing

objFile.WriteLine "Análise concluída!"
objFile.Close

WScript.Echo "Resultado salvo em: resultado_db_blitz.txt"