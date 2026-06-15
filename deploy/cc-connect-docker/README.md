# cc-connect WSL Docker Runtime

This runtime keeps the fork close to upstream and avoids committing local
credentials. The image contains only `cc-connect` and the Linux Codex CLI;
Feishu credentials, runtime data, and Codex home are mounted from outside the
repository.

## Codex Runtime Boundary

This Docker runtime uses the Linux Codex CLI installed inside the container.
It is not a direct connection to the currently running Codex Desktop process.

The container mounts the host Codex home:

```bash
/mnt/c/Users/Administrator/.codex -> /codex-home
```

That lets container Codex reuse the host Codex account, config, skills, and
session files where compatible. It is the right default for a stable Feishu
bot. Desktop session takeover is a separate compatibility check because Codex
Desktop records Windows project paths, while the container runs with Linux
paths such as `/workspaces/cc-connect-fork`.

## Prepare Runtime Config

Run from WSL:

```bash
cd /mnt/f/development/cc-connect-fork
./deploy/cc-connect-docker/prepare-runtime.sh
```

Then edit:

```bash
vim ~/.cc-connect-docker/config/config.toml
```

Fill only:

- `app_id`
- `app_secret`

Keep the container paths as-is:

- `work_dir = "/workspaces/cc-connect-fork"`
- `codex_home = "/codex-home"`
- `data_dir = "/data"`

## Build And Start

```bash
cd /mnt/f/development/cc-connect-fork
export CC_CONNECT_RUNTIME_DIR="$HOME/.cc-connect-docker"
export CC_CONNECT_CODEX_HOME="/mnt/c/Users/Administrator/.codex"
export CC_CONNECT_WORKSPACE="/mnt/f/development/cc-connect-fork"
docker compose -f deploy/cc-connect-docker/compose.yml up -d --build
```

If upstream package downloads are slow, add a command-level proxy only for the
build:

```bash
export APT_PROXY="http://127.0.0.1:7890"
docker compose --env-file "$HOME/.cc-connect-docker/.env" \
  -f deploy/cc-connect-docker/compose.yml build
```

Check status:

```bash
docker ps --filter name=cc-connect-codex-feishu
docker logs -f cc-connect-codex-feishu
```

Stop:

```bash
docker compose -f deploy/cc-connect-docker/compose.yml down
```
