# Windows Daemon Runtime (Legacy)

This path is kept for upstream compatibility and for reusable build/config
assets. It is not the current local runtime for this machine.

For the local Feishu + Codex bridge, use the NSSM service flow in
`deploy/windows-service/README.md`. The `cc-connect daemon install` path on
Windows creates a Task Scheduler entry, which can conflict with the service
runtime and leave logon-triggered tasks running.

## Build

Run from WSL:

```bash
cd /mnt/f/development/cc-connect-fork
docker run --rm \
  -e GOPROXY=https://goproxy.cn,direct \
  -e GOSUMDB=sum.golang.google.cn \
  -e GOFLAGS=-buildvcs=false \
  -e CC_CONNECT_COMMIT="$(git rev-parse --short HEAD)" \
  -e CC_CONNECT_BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  -v /mnt/f/development/cc-connect-fork:/src \
  -w /src \
  golang:1.25 \
  bash deploy/windows-daemon/build-windows-amd64.sh
```

## Prepare Config

Create the runtime config on Windows:

```powershell
New-Item -ItemType Directory -Force -LiteralPath C:\Users\Administrator\.cc-connect | Out-Null
Copy-Item -LiteralPath F:\development\cc-connect-fork\deploy\windows-daemon\config.template.toml -Destination C:\Users\Administrator\.cc-connect\config.toml
```

Then edit `C:\Users\Administrator\.cc-connect\config.toml` and fill:

- `app_id`
- `app_secret`

## Install Daemon

```powershell
F:\development\cc-connect-fork\dist\cc-connect-v1.3.3-beta.4-windows-amd64.exe daemon install --config C:\Users\Administrator\.cc-connect\config.toml --force
F:\development\cc-connect-fork\dist\cc-connect-v1.3.3-beta.4-windows-amd64.exe daemon status
F:\development\cc-connect-fork\dist\cc-connect-v1.3.3-beta.4-windows-amd64.exe daemon logs -f
```

Do not run the install commands above for the current local service deployment
unless you are intentionally testing the legacy Task Scheduler mode. The Windows
daemon uses Task Scheduler and runs hidden under the current user.
