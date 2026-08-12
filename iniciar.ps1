# InfraGeo AM — sobe a API/UI e abre o navegador quando estiver pronto.
# Uso:  .\iniciar.ps1

$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "InfraGeo AM"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  InfraGeo AM"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Pasta: $PWD"
Write-Host ""

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$app = Join-Path $PSScriptRoot "app.py"

if (-not (Test-Path -LiteralPath $python)) {
  Write-Host "[ERRO] Nao achei .venv\Scripts\python.exe" -ForegroundColor Red
  Write-Host "Crie com: python -m venv .venv"
  Write-Host "Depois:   .\.venv\Scripts\pip.exe install -r requirements.txt"
  Read-Host "Enter para sair"
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot ".env"))) {
  $example = Join-Path $PSScriptRoot ".env.example"
  if (Test-Path -LiteralPath $example) {
    Copy-Item -LiteralPath $example -Destination (Join-Path $PSScriptRoot ".env") -Force
    Write-Host "[AVISO] .env criado a partir de .env.example" -ForegroundColor Yellow
  }
}

# Libera porta 8000
try {
  Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      Write-Host "[AVISO] Encerrando processo na porta 8000 (PID $_)" -ForegroundColor Yellow
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
} catch {}

Write-Host "Servidor: http://127.0.0.1:8000/" -ForegroundColor Green
Write-Host "Para parar: Ctrl+C"
Write-Host ""

# Abre o browser quando /api/health responder
Start-Job -ScriptBlock {
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) {
        Start-Process "http://127.0.0.1:8000/"
        return
      }
    } catch {}
  }
} | Out-Null

& $python $app
$code = $LASTEXITCODE
Write-Host ""
if ($code -ne 0) {
  Write-Host "[ERRO] Servidor encerrou com codigo $code" -ForegroundColor Red
  Read-Host "Enter para sair"
}
exit $code
