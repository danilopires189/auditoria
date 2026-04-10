Option Explicit

Dim objFSO, objShell, strConfigFile, arrArquivos, i
Dim strArquivo, strComando, intResultado, strOutput

Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

' Lista de todos os arquivos para verificar
arrArquivos = Array( _
    "DB_BARRAS.xlsx", _
    "BD_AVULSO.xlsx", _
    "BD_ROTAS.xlsx", _
    "DB_LOG_END.xlsx", _
    "DB_USUARIO.xlsx", _
    "DB_PROD_VOL.xlsx", _
    "DB_GESTAO_ESTQ.xlsx", _
    "DB_TRANSF_CD.xlsx", _
    "BD_END.xlsx", _
    "DB_TERMO.xlsx", _
    "DB_PEDIDO_DIRETO.xlsx", _
    "DB_PROD_BLITZ.xlsx", _
    "DB_ATENDIMENTO.xlsx", _
    "DB_ESTQ_ENTR.xlsx", _
    "DB_ENTRADA_NOTAS.xlsx", _
    "DB_DEVOLUCAO.xlsx", _
    "DB_BLITZ.xlsx" _
)

WScript.Echo "=========================================="
WScript.Echo "STATUS DE FREQUÊNCIA - TODOS OS ARQUIVOS"
WScript.Echo "=========================================="
WScript.Echo ""

For i = 0 To UBound(arrArquivos)
    strArquivo = arrArquivos(i)
    
    ' Verificar se arquivo existe
    If objFSO.FileExists("data\" & strArquivo) Then
        ' Executar verificação de frequência
        strComando = "cscript //NoLogo verificar_frequencia.vbs """ & strArquivo & """"
        intResultado = objShell.Run(strComando, 0, True)
        
        ' Capturar output
        Dim objExec
        Set objExec = objShell.Exec(strComando)
        strOutput = objExec.StdOut.ReadAll()
        
        WScript.Echo strOutput
        WScript.Echo "----------------------------------------"
    Else
        WScript.Echo "ERRO: Arquivo não encontrado - " & strArquivo
        WScript.Echo "----------------------------------------"
    End If
Next

WScript.Echo ""
WScript.Echo "Verificação concluída!"
WScript.Echo "=========================================="
