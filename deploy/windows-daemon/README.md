# Windows Daemon Runtime

Use this path when the goal is to run against the host Windows Codex runtime
and Windows project paths. This is the better fit for Codex Desktop session
compatibility than the WSL Docker runtime.

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

The Windows daemon uses Task Scheduler and runs hidden under the current user.
