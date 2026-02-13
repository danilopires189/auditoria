@echo off
setlocal

set "BASE_DIR=%~dp0"
set "PYTHON_EXE="
if exist "%BASE_DIR%.venv\Scripts\python.exe" set "PYTHON_EXE=%BASE_DIR%.venv\Scripts\python.exe"
if not defined PYTHON_EXE if exist "%BASE_DIR%..\.venv\Scripts\python.exe" set "PYTHON_EXE=%BASE_DIR%..\.venv\Scripts\python.exe"

set "EXE=%BASE_DIR%dist\sync_backend.exe"
if not exist "%EXE%" if exist "%BASE_DIR%sync_backend.exe" set "EXE=%BASE_DIR%sync_backend.exe"

rem Modo DEV: se houver codigo-fonte e Python disponivel, prioriza Python para evitar exe desatualizado.
if exist "%BASE_DIR%main.py" if defined PYTHON_EXE (
  echo [sync] mode=dev python="%PYTHON_EXE%"
  "%PYTHON_EXE%" "%BASE_DIR%main.py" sync --config "%BASE_DIR%config.yml" --env-file "%BASE_DIR%.env"
  exit /b %errorlevel%
)

rem Modo PROD: usa executavel quando Python/codigo-fonte nao for caminho principal.
if exist "%EXE%" (
  echo [sync] mode=prod exe="%EXE%"
  "%EXE%" sync --config "%BASE_DIR%config.yml" --env-file "%BASE_DIR%.env"
  exit /b %errorlevel%
)

if defined PYTHON_EXE (
  echo [sync] mode=fallback python="%PYTHON_EXE%"
  "%PYTHON_EXE%" "%BASE_DIR%main.py" sync --config "%BASE_DIR%config.yml" --env-file "%BASE_DIR%.env"
  exit /b %errorlevel%
)

echo Python and sync_backend.exe not found.
exit /b 1
