$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$serviceDir = 'F:\development\cc-connect-service'
$logsDir = Join-Path $serviceDir 'logs'
$binarySource = Join-Path $repo 'dist\cc-connect-v1.3.3-beta.4-windows-amd64.exe'
$binaryTarget = Join-Path $serviceDir 'cc-connect.exe'
$configTemplate = Join-Path $repo 'deploy\windows-daemon\config.template.toml'
$configTarget = Join-Path $serviceDir 'config.toml'
$xmlSource = Join-Path $repo 'deploy\windows-service\cc-connect-service.xml'
$xmlTarget = Join-Path $serviceDir 'cc-connect-service.xml'

if (-not (Test-Path -LiteralPath $binarySource)) {
  throw "Missing Windows binary: $binarySource. Build it first with deploy/windows-daemon/build-windows-amd64.sh."
}

New-Item -ItemType Directory -Force -Path $serviceDir | Out-Null
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

Copy-Item -LiteralPath $binarySource -Destination $binaryTarget -Force
Copy-Item -LiteralPath $xmlSource -Destination $xmlTarget -Force

if (-not (Test-Path -LiteralPath $configTarget)) {
  Copy-Item -LiteralPath $configTemplate -Destination $configTarget
  Write-Host "Created config: $configTarget"
  Write-Host "Edit app_id and app_secret before installing the service."
} else {
  Write-Host "Config already exists: $configTarget"
  Write-Host "Not overwriting it."
}

Write-Host "Prepared service directory: $serviceDir"
