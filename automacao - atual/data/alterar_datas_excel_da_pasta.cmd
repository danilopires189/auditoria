@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================
REM ALTERA DATA DE MODIFICACAO DE TODOS OS EXCEL
REM DA PASTA ONDE ESTE ARQUIVO .CMD ESTA
REM ============================================

where node >nul 2>&1
if errorlevel 1 (
    echo ERRO: Node.js nao foi encontrado neste computador.
    pause
    exit /b 1
)

REM Entra na pasta do proprio .cmd para evitar erro com aspas e barra final
cd /d "%~dp0"

node -e "const fs=require('fs'); const path=require('path'); const pasta=process.cwd(); const data=new Date(2015,5-1,6,15,19,0); const exts=['.xlsx','.xls','.xlsm','.xlsb']; let total=0, ok=0; fs.readdirSync(pasta).forEach(f=>{ const p=path.join(pasta,f); try{ if(fs.statSync(p).isFile() && exts.includes(path.extname(f).toLowerCase())){ total++; fs.utimesSync(p,data,data); ok++; console.log('OK -> '+p); } } catch(e){ console.log('ERRO -> '+p+' | '+e.message); } }); console.log('----------------------------------------'); console.log('Arquivos Excel alterados: '+ok+' de '+total);"

echo.
echo Concluido.
pause
