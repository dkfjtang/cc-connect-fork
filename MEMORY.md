# cc-connect-fork Project Memory

## 2026-06-09 - Fork Transition

### Key Rules

- Primary workspace is `F:\development\cc-connect-fork`.
- Treat `F:\development\f-codex` as transitional/legacy unless explicitly asked otherwise.
- Remote layout:
  - `origin`: `https://github.com/dkfjtang/cc-connect-fork.git`
  - `upstream`: `https://github.com/chenhg5/cc-connect.git`
- Keep this fork close to upstream `chenhg5/cc-connect`; do not let it become
  an independent long-lived product branch.
- Prefer small upstream-compatible fix patches that can be rebased, reapplied,
  or retired as upstream cc-connect evolves.
- Do not print or commit Feishu credentials, tokens, temp configs containing secrets, or raw WebSocket payloads.
- Default build/deployment validation path is WSL + Docker container build.
- For external downloads, use command-level proxy `127.0.0.1:7890` only when reachable; do not persist proxy settings into repo or system config.

### Feishu + Codex App-Server Baseline

- Use `cc-connect` fork strategy; previous FCA/self-developed Feishu Codex bridge path is abandoned.
- Prefer Codex `app_server` backend with:

```toml
[projects.agent]
type = "codex"
backend = "app_server"
app_server_url = "stdio://"
codex_home = "C:/Users/Administrator/.codex"
```

- Accepted Feishu UX target:
  - single continuously updated rich card,
  - visible reasoning section,
  - hidden tool progress messages,
  - final footer with elapsed time, model, token/cache/context information.
- `mode = "yolo"` is acceptable for this deployment to avoid permission approval cards showing commands.
- If non-yolo is later required, patch permission cards to summarize or hide command content.

### Recommended Smoke Config Shape

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

Feishu platform options used in smoke:

```toml
enable_feishu_card = true
progress_style = "card"
done_emoji = "none"
thread_isolation = true
```

### Verified Facts

- `cc-connect v1.3.3-beta.4` built from the fork produced the desired rich-card smoke behavior.
- Older downloaded `v1.3.2` binary did not produce the desired rich-card behavior.
- `max_turn_time_mins = 2` caused `agent turn exceeded maximum time (2m0s), stopping`.
- `max_turn_time_mins = 15` resolved the smoke timeout for short analysis turns.
- `tool_messages = false` hides tool progress but does not hide command text in permission cards under `suggest` mode.
- `mode = "yolo"` avoids the approval-card command exposure path.

### WSL Docker Build Command

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

Notes:

- `go.mod` declares `go 1.25.0`; use `golang:1.25`.
- `GOFLAGS=-buildvcs=false` avoids VCS stamping failure inside Docker-mounted Windows worktrees.
- During the initial smoke, containers could not directly reach Windows localhost proxy on `127.0.0.1:7890` or `host.docker.internal:7890`; `goproxy.cn` worked for Go module downloads.

### Key Files

- `docs/fork-transition.md`: fork transition, recommended config, and build policy.
- `docs/session-summaries/2026-06-09-cc-connect-fork-transition.md`: detailed session archive and evidence-backed conclusions.
- `core/engine.go`: display config and rich-card orchestration.
- `platform/feishu/feishu.go`: Feishu rich cards, streaming updates, and footer rendering.
- `agent/codex/appserver_session.go`: Codex app-server integration.

### Follow-ups

- Commit and push `MEMORY.md`, `docs/fork-transition.md`, and session summary.
- Decide whether to archive/delete `F:\development\f-codex` after confirming no useful local-only files remain.
- Rebuild from `F:\development\cc-connect-fork` when a fresh runnable binary is needed.
- Optional future patch: non-yolo approval-card command redaction/summarization.
