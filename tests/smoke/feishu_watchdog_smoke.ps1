param(
  [string]$CcConnect = "cc-connect",
  [string]$Config,
  [string]$DataDir,
  [string]$Task = "watchdog smoke test",
  [string]$Summary = "verify Feishu decision loop",
  [int]$ElapsedMins = 11,
  [int]$ThresholdMins = 10,
  [int]$TimeoutMins = 30,
  [switch]$NoWait
)

$ErrorActionPreference = "Stop"

function Resolve-CandidateConfig {
  param([string]$Explicit)
  if ($Explicit) {
    return $Explicit
  }
  $candidates = @(
    (Join-Path (Get-Location) "config.toml"),
    (Join-Path $HOME ".cc-connect\config.toml"),
    (Join-Path $env:APPDATA "cc-connect\config.toml")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  return ""
}

function Test-ConfigLine {
  param([string]$Path, [string]$Pattern)
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return $false
  }
  return [bool](Select-String -LiteralPath $Path -Pattern $Pattern -Quiet)
}

$configPath = Resolve-CandidateConfig -Explicit $Config
if (-not $configPath) {
    throw "No config.toml found. Start cc-connect once to create ~/.cc-connect/config.toml or pass -Config PATH."
}

$ccCommand = Get-Command $CcConnect -ErrorAction SilentlyContinue
if (-not $ccCommand -and -not (Test-Path -LiteralPath $CcConnect)) {
  throw "cc-connect binary not found: $CcConnect. Pass -CcConnect PATH_TO_CC_CONNECT_EXE."
}

if (-not (Test-ConfigLine -Path $configPath -Pattern '^\s*\[notify\.feishu\]\s*$')) {
  throw "Missing [notify.feishu] in config: $configPath"
}
if (-not (Test-ConfigLine -Path $configPath -Pattern '^\s*default_user_id\s*=')) {
  throw "Missing notify.feishu.default_user_id in config: $configPath"
}
if (Test-ConfigLine -Path $configPath -Pattern '^\s*enable_feishu_card\s*=\s*false\s*$') {
  throw "enable_feishu_card=false found in config. Decision cards require Feishu interactive cards."
}

$args = @(
  "watchdog", "checkpoint",
  "--task", $Task,
  "--summary", $Summary,
  "--elapsed-mins", [string]$ElapsedMins,
  "--threshold-mins", [string]$ThresholdMins,
  "--timeout-mins", [string]$TimeoutMins
)
if ($DataDir) {
  $args += @("--data-dir", $DataDir)
}
if (-not $NoWait) {
  $args += "--wait"
}

Write-Host "Config: $configPath"
Write-Host "Command: $CcConnect $($args -join ' ')"
Write-Host "Expected: Feishu private decision card. Click a button in Feishu to resolve this command."
& $CcConnect @args
