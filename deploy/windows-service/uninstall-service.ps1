$ErrorActionPreference = 'Stop'

$serviceName = 'cc-connect-codex-feishu'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$nssm = Join-Path $repo 'deploy\windows-service\bin\nssm.exe'
if (-not (Test-Path -LiteralPath $nssm)) {
  Write-Host "NSSM not found: $nssm"
  exit 0
}

try {
  & $nssm stop $serviceName
} catch {
  Write-Warning $_
}

& $nssm remove $serviceName confirm
