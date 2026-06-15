# Add personal Feishu decision watchdog

## Summary

Adds a personal Feishu decision/watchdog flow for local Codex tasks:

- `cc-connect decision ask` local API/CLI for personal Feishu decision cards.
- Feishu private cards with Chinese buttons, optional comment, and resolved-card replacement.
- `cc-connect watchdog checkpoint` for long-running task checkpoints.
- Service-oriented operation notes for the existing NSSM deployment.
- Notification deduplication with `event_key`, `event_fingerprint`, and `cooldown_mins`.
- Windows test fixes so `cmd/cc-connect` package tests pass with `-tags no_web`.

## Runtime Validation

Validated locally on Windows service mode:

- NSSM service: `cc-connect-codex-feishu` running as Automatic.
- Runtime binary deployed at `F:\development\cc-connect-service\cc-connect.exe`.
- API socket: `F:\development\cc-connect-service\data\run\api.sock`.
- Feishu decision card receives button and text comment.
- Resolved cards are replaced with a no-button result card.
- Dedup smoke: first event creates a card; second identical `event-key/fingerprint` returns `notification=deduped`.
- Codex automation巡检 can send a Feishu decision and回写决策到目标线程.

## Verification

```text
go test -tags no_web ./cmd/cc-connect
go test -tags no_web ./core -run 'TestDecision|TestNotification|TestHandleSend'
go build -tags no_web ./cmd/cc-connect
git diff --check
```

`feishu-watchdog` user skill validation also passed locally.

## Remaining Operational Note

The deployed local service config contains Feishu credentials. The `app_secret` should be rotated in Feishu and updated in the runtime `config.toml` before treating the local deployment as clean from a security perspective.
