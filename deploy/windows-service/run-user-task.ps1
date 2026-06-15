$ErrorActionPreference = 'Stop'

$serviceDir = 'F:\development\cc-connect-service'
$logsDir = Join-Path $serviceDir 'logs'
$exe = Join-Path $serviceDir 'cc-connect.exe'
$stdout = Join-Path $logsDir 'cc-connect.user.out.log'
$stderr = Join-Path $logsDir 'cc-connect.user.err.log'

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Set-Location -LiteralPath $serviceDir

Start-Process `
  -FilePath $exe `
  -WorkingDirectory $serviceDir `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -WindowStyle Hidden `
  -Wait
