@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "EXIT_CODE=0"

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
  set "EXIT_CODE=!errorlevel!"
  goto :end
)

rem Modo PROD: usa executavel quando Python/codigo-fonte nao for caminho principal.
if exist "%EXE%" (
  echo [sync] mode=prod exe="%EXE%"
  "%EXE%" sync --config "%BASE_DIR%config.yml" --env-file "%BASE_DIR%.env"
  set "EXIT_CODE=!errorlevel!"
  goto :end
)

if defined PYTHON_EXE (
  echo [sync] mode=fallback python="%PYTHON_EXE%"
  "%PYTHON_EXE%" "%BASE_DIR%main.py" sync --config "%BASE_DIR%config.yml" --env-file "%BASE_DIR%.env"
  set "EXIT_CODE=!errorlevel!"
  goto :end
)

echo Python and sync_backend.exe not found.
set "EXIT_CODE=1"

:end
if "!EXIT_CODE!"=="2" (
  echo.
  echo [sync] another sync process is already running. This run was skipped.
  pause
  exit /b 0
)

if not "!EXIT_CODE!"=="0" (
  echo.
  echo [sync] failed with exit code !EXIT_CODE!.
  pause
)
exit /b !EXIT_CODE!
