$ErrorActionPreference = 'Stop'

$serviceName = 'cc-connect-codex-feishu'
$serviceDir = 'F:\development\cc-connect-service'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$nssm = Join-Path $repo 'deploy\windows-service\bin\nssm.exe'
$exe = Join-Path $serviceDir 'cc-connect.exe'
$config = Join-Path $serviceDir 'config.toml'
$stdout = Join-Path $serviceDir 'logs\cc-connect.out.log'
$stderr = Join-Path $serviceDir 'logs\cc-connect.err.log'

if (-not (Test-Path -LiteralPath $nssm)) {
  throw "Missing NSSM: $nssm"
}
if (-not (Test-Path -LiteralPath $exe)) {
  throw "Missing cc-connect binary: $exe. Run prepare-service.ps1 first."
}
if (-not (Test-Path -LiteralPath $config)) {
  throw "Missing config: $config. Run prepare-service.ps1 first."
}

cmd /c "`"$nssm`" stop $serviceName >nul 2>nul"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Service was not running or does not exist yet."
}
cmd /c "`"$nssm`" remove $serviceName confirm >nul 2>nul"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Service did not exist yet."
}

& $nssm install $serviceName $exe "--config `"$config`" --force"
& $nssm set $serviceName AppDirectory $serviceDir
& $nssm set $serviceName AppEnvironmentExtra "CODEX_HOME=C:\Users\Administrator\.codex" "PATH=C:\nvm4w\nodejs;%PATH%"
& $nssm set $serviceName AppStdout $stdout
& $nssm set $serviceName AppStderr $stderr
& $nssm set $serviceName AppRotateFiles 1
& $nssm set $serviceName AppRotateOnline 1
& $nssm set $serviceName AppRotateBytes 10485760
& $nssm set $serviceName AppRestartDelay 10000
& $nssm set $serviceName Start SERVICE_AUTO_START

& $nssm start $serviceName
& $nssm status $serviceName
