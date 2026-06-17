# Windows Service Runtime

This is the current Windows runtime for the local Feishu + Codex bridge.

Use this runtime when cc-connect should run as a real Windows Service instead
of the built-in Windows Task Scheduler daemon.

The service uses NSSM as a wrapper around the compiled `cc-connect.exe`.
This avoids changing fork code and keeps local service management separate from
upstream cc-connect changes.

Do not install the local runtime through `cc-connect daemon install` on this
machine. On Windows that upstream daemon path creates a Task Scheduler entry,
which can conflict with the NSSM service and leave old logon-triggered tasks
running after the service migration.

## Files

- `prepare-service.ps1`: creates `F:\development\cc-connect-service`, copies the exe,
  template config, and service XML.
- `install-service.ps1`: installs/starts the service through local NSSM.
- `uninstall-service.ps1`: stops and removes service.
- `status-service.ps1`: shows Windows service status.

## Prepare

First build the Windows binary:

```bash
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/f/development/cc-connect-fork && docker run --rm -e GOPROXY=https://goproxy.cn,direct -e GOSUMDB=sum.golang.google.cn -e GOFLAGS=-buildvcs=false -e CC_CONNECT_COMMIT="$(git rev-parse --short HEAD)" -e CC_CONNECT_BUILD_TIME="$(date -u "+%Y-%m-%dT%H:%M:%SZ")" -v /mnt/f/development/cc-connect-fork:/src -w /src golang:1.25 bash deploy/windows-daemon/build-windows-amd64.sh'
```

Then run PowerShell as Administrator:

```powershell
Set-Location F:\development\cc-connect-fork
.\deploy\windows-service\prepare-service.ps1
```

Edit:

```powershell
notepad F:\development\cc-connect-service\config.toml
```

Fill only:

- `app_id`
- `app_secret`

Keep the Windows paths unchanged:

- `work_dir = "F:/development/cc-connect-fork"`
- `codex_home = "C:/Users/Administrator/.codex"`

## Install And Start

Run PowerShell as Administrator:

```powershell
Set-Location F:\development\cc-connect-fork
.\deploy\windows-service\install-service.ps1
.\deploy\windows-service\status-service.ps1
```

Follow logs:

```powershell
Get-Content -LiteralPath F:\development\cc-connect-service\logs\cc-connect.out.log -Wait
Get-Content -LiteralPath F:\development\cc-connect-service\logs\cc-connect.err.log -Wait
```

## Stop Or Remove

```powershell
.\deploy\windows-service\uninstall-service.ps1
```

## Notes

The service runs as `LocalSystem` by default unless you change it in Windows
Service Manager or NSSM. If Codex authentication or user-specific files
are not visible under `LocalSystem`, configure the service Log On account to
the Windows user that owns `C:\Users\Administrator\.codex`.

If a PowerShell window still appears at logon, check for unrelated or legacy
scheduled tasks before changing this service:

```powershell
Get-ScheduledTask | Where-Object {
  $_.TaskName -match 'cc-connect|WSLDashboard|wsl|port|proxy' -or
  $_.TaskPath -match 'cc-connect|WSLDashboard|wsl|port|proxy' -or
  ($_.Actions | Out-String) -match 'cc-connect|WSLDashboard|wsl|port|proxy'
}
```

The expected cc-connect runtime is the Windows service named
`cc-connect-codex-feishu`, not a logon-triggered scheduled task.
