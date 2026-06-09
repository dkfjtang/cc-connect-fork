# 2026-06-09 - cc-connect-fork transition

## Key Information

- FCA / previous Feishu Codex bridge self-development is paused and replaced by a `cc-connect` fork strategy.
- Main local fork workspace is now `F:\development\cc-connect-fork`.
- Git remotes in `F:\development\cc-connect-fork`:
  - `origin`: `https://github.com/dkfjtang/cc-connect-fork.git`
  - `upstream`: `https://github.com/chenhg5/cc-connect.git`
- Old local workspace `F:\development\f-codex` still exists but should no longer be the primary working directory.
- The fork baseline commit is `98a2f7a`, originally replacing FCA with the cc-connect fork baseline.
- Do not store or print Feishu `app_id`, `app_secret`, tokens, or temp config contents containing secrets.

## Project Decisions

- Build and deployment validation should use WSL + Docker containers by default.
- The fork should keep tracking upstream `chenhg5/cc-connect`; avoid turning it
  into an independent long-lived branch.
- Local patches should stay small, upstream-compatible, and removable when
  upstream cc-connect catches up.
- Use `golang:1.25` for current builds because `go.mod` declares `go 1.25.0`.
- For the Feishu + Codex path, prefer the Codex `app_server` backend with `app_server_url = "stdio://"`.
- Current accepted Feishu UX target:
  - one continuously updated rich card,
  - visible reasoning section,
  - hidden tool progress messages,
  - final footer with elapsed time, model, token/cache/context details,
  - `yolo` mode is acceptable to avoid command approval cards.
- Long-term non-yolo parity with OpenClaw would still require a code patch to hide or summarize command details inside approval cards.

## Verified Behavior

- Current fork source built successfully as `cc-connect v1.3.3-beta.4` using Docker/WSL.
- The earlier downloaded `v1.3.2` binary did not produce the desired Feishu rich-card experience.
- The fork build with rich card settings successfully produced one continuously updated Feishu card.
- The final Feishu card displayed `Done`, elapsed time, model, token/cache/context/footer information.
- `max_turn_time_mins = 2` caused a real failure: `agent turn exceeded maximum time (2m0s), stopping`.
- Raising `max_turn_time_mins` to `15` resolved the smoke timeout for normal short analysis.
- `tool_messages = false` hides tool progress, but does not hide command content in permission approval cards when using `suggest` mode.
- Switching to `mode = "yolo"` avoids the approval-card command exposure path.

## Current Recommended Config Shape

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

For Feishu platform options, the smoke config also used:

```toml
enable_feishu_card = true
progress_style = "card"
done_emoji = "none"
thread_isolation = true
```

For Codex app-server:

```toml
[projects.agent]
type = "codex"
backend = "app_server"
app_server_url = "stdio://"
codex_home = "C:/Users/Administrator/.codex"
```

## Build Command

Run from WSL/Docker against the new primary workspace:

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

- Pulling Docker images may use the local proxy `127.0.0.1:7890` when reachable.
- During this session, Docker containers could not directly reach Windows localhost proxy on `127.0.0.1:7890` or `host.docker.internal:7890`; `goproxy.cn` worked for Go module download.
- `GOFLAGS=-buildvcs=false` was required because Go VCS stamping failed inside the container-mounted Windows working tree.

## Source Comparison Conclusions

- OpenClaw official Feishu plugin uses CardKit card entities, streams into card elements, separates reasoning and answer streams, controls tool display independently, and renders a structured final footer.
- cc-connect already has enough rich-card capability for the accepted smoke target:
  - `core/engine.go` controls display config and rich-card flow.
  - `platform/feishu/feishu.go` contains rich card, streaming, status footer, and progress-card logic.
  - `agent/codex/appserver_session.go` is the Codex app-server integration point.
- Current remaining product gap is permission-card command exposure in non-yolo mode.

## Files And Local State

- `F:\development\cc-connect-fork\docs\fork-transition.md` was updated to the new fork wording, recommended display config, and WSL/Docker build policy.
- `F:\development\f-codex\docs\fork-transition.md` has the same uncommitted documentation update, but that workspace should be considered transitional.
- `dist/` in `F:\development\f-codex` was removed as local build output.
- `node_modules/` was not removed; it is ignored dependency state, not old project residue.

## Follow-ups

- Commit and push the documentation updates from `F:\development\cc-connect-fork`.
- Decide whether to archive or delete `F:\development\f-codex` after confirming all useful work has moved to `F:\development\cc-connect-fork`.
- Run one more yolo-mode Feishu smoke from the new primary workspace if a fresh binary is needed.
- If non-yolo mode becomes required, patch Feishu permission cards to hide or summarize command content.
- Optional: add a project `MEMORY.md` later with the stable commands and config once the fork layout is final.

## Dropped Noise

- Raw Feishu credentials and temp config secret values were not preserved.
- Long Feishu WebSocket payloads, raw logs, and screenshot image paths were not preserved.
- Failed shell quoting attempts and transient WSL warning text were summarized only where they produced reusable build guidance.
