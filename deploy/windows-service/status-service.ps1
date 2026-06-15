$ErrorActionPreference = 'Stop'

$serviceName = 'cc-connect-codex-feishu'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$nssm = Join-Path $repo 'deploy\windows-service\bin\nssm.exe'
if (Test-Path -LiteralPath $nssm) {
  & $nssm status $serviceName
} else {
  Get-Service -Name $serviceName -ErrorAction SilentlyContinue
}
