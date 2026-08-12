@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

title InfraGeo AM
echo.
echo ========================================
echo   InfraGeo AM
echo ========================================
echo   Pasta: %CD%
echo.

if not exist "%~dp0.venv\Scripts\python.exe" (
  echo [ERRO] Nao achei .venv\Scripts\python.exe
  echo.
  echo Crie o ambiente:
  echo   python -m venv .venv
  echo   .venv\Scripts\pip.exe install -r requirements.txt
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0.env" (
  if exist "%~dp0.env.example" (
    copy /y "%~dp0.env.example" "%~dp0.env" >nul
    echo [AVISO] .env criado a partir de .env.example
  )
)

REM Libera a porta 8000 se estiver ocupada por outro python
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
  echo [AVISO] Porta 8000 em uso pelo PID %%p — encerrando...
  taskkill /F /PID %%p >nul 2>&1
)

echo Iniciando servidor em http://127.0.0.1:8000/
echo Para parar: Ctrl+C
echo.

REM Abre o navegador quando a API responder (ate ~30s)
start "InfraGeo-browser" /min cmd /c "for /l %%i in (1,1,30) do (curl -s -o nul -m 1 http://127.0.0.1:8000/api/health && start http://127.0.0.1:8000/ && exit /b 0 & timeout /t 1 /nobreak >nul)"

"%~dp0.venv\Scripts\python.exe" "%~dp0app.py"
set ERR=%ERRORLEVEL%

echo.
if not "%ERR%"=="0" (
  echo [ERRO] Servidor encerrou com codigo %ERR%.
)
pause
exit /b %ERR%
