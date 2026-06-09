# cc-connect-fork transition

This repository now tracks `cc-connect` as the fork baseline. The previous
prototype has been retired from the active codebase.

## Baseline

- Fork repository: `dkfjtang/cc-connect-fork`
- Upstream source: `chenhg5/cc-connect`
- Imported commit: `5e2f3b9ebab125bc09c99b8b2dc2cd8526c709ba`
- Previous prototype code, scripts, tests, and design drafts are removed from
  the active codebase.

## Upstream policy

Keep this fork close to upstream `chenhg5/cc-connect`. Local changes should
stay small, upstream-compatible, and easy to rebase or retire when upstream
cc-connect adds equivalent behavior. Do not evolve this fork as an independent
long-lived product branch.

## Codex app-server settings

For Codex integration, prefer the app-server backend:

```toml
[[projects]]
name = "codex-desktop-takeover"
work_dir = "F:/development/f-codex"

[projects.agent]
type = "codex"
backend = "app_server"
app_server_url = "stdio://"
codex_home = "C:/Users/Administrator/.codex"
```

Notes:

- The `work_dir` above records the original Desktop-takeover smoke target.
  For new fork work, use `F:/development/cc-connect-fork`.
- Use `app_server_url = "stdio://"` with current Codex CLI versions. The old
  bare value `stdio` is normalized by cc-connect in code, but the explicit URL
  form is the compatible configuration target.
- For clean bot smoke tests, use an isolated `codex_home` so global Codex
  skills and desktop history do not affect the result.
- For Codex Desktop session takeover, point `codex_home` to the real Codex home
  and keep `work_dir` aligned with the target Desktop thread.

## Verified behavior

The Feishu + Codex app-server smoke path was verified with cc-connect
v1.3.3-beta.4 built from this fork and Codex CLI 0.137.0.

Recommended Feishu display settings for the current fork:

```toml
mode = "yolo"
max_turn_time_mins = 15

[display]
mode = "full"
card_mode = "rich"
thinking_messages = true
tool_messages = false
reply_footer = true
```

With these settings, Feishu uses one continuously updated rich card, shows the
reasoning section, suppresses tool progress messages, and renders the final
footer with elapsed time, model, token, cache, and context information.

Desktop session takeover was also verified. cc-connect resumed the Codex
Desktop thread:

```text
019ea6fc-08ee-7233-8060-5a15315587f8
```

The local cc-connect log showed `codex app-server thread resumed` and
`is_resume=true`, and the Desktop session JSONL was appended by the resumed
turn. This confirms that cc-connect can resume a Codex Desktop session when it
uses the same Codex home and matching project working directory.

## Build policy

Build and deployment validation should run through WSL with Docker containers.
For a Windows amd64 smoke binary:

```bash
docker run --rm \
  -e GOPROXY=https://goproxy.cn,direct \
  -e GOSUMDB=sum.golang.google.cn \
  -e GOFLAGS=-buildvcs=false \
  -v /mnt/f/development/cc-connect-fork:/src \
  -w /src \
  golang:1.25 \
  sh -c 'make release TARGET=windows/amd64 AGENTS=codex PLATFORMS_INCLUDE=feishu NO_WEB=1'
```

Use the local proxy `127.0.0.1:7890` only as a temporary command-level proxy
when the Docker or upstream network path can reach it. Do not persist proxy
settings into the repository.
