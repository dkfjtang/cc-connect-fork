# Add personal Feishu decision watchdog

## Manual PR

GitHub connector PR creation is currently blocked by integration permissions. Create the draft PR manually with:

- Compare URL: `https://github.com/dkfjtang/cc-connect-fork/compare/main...codex/personal-feishu-decision-watchdog?quick_pull=1`
- Base: `main`
- Head: `codex/personal-feishu-decision-watchdog`
- Title: `Add personal Feishu decision watchdog`
- Draft: yes

Before opening the PR, confirm the head branch includes:

- `f9fbdd4 docs: prefer config-based watchdog CLI examples`
- `32791a9 docs: refresh Feishu watchdog PR draft`
- `17f6e13 feat: resolve CLI socket from config`
- `32e356d fix: wrap Feishu decision buttons`
- `5641412 feat: expand feishu decision choices`

## Summary

Adds a personal Feishu decision/watchdog flow for local Codex tasks:

- `cc-connect decision ask` local API/CLI for personal Feishu decision cards.
- Feishu private cards with Chinese buttons, optional comment, and resolved-card replacement.
- Six decision choices for unattended watchdog flows: continue, pause, revise, ignore, remind later, and reconnect/wake.
- Decision buttons wrap into rows in Feishu so longer Chinese labels are not truncated.
- `cc-connect watchdog checkpoint` for long-running task checkpoints.
- Notification deduplication with `event_key`, `event_fingerprint`, and `cooldown_mins`.
- CLI socket discovery from `--data-dir`, `--config data_dir`, `CC_DATA_DIR`, and running service config lock.
- Service-oriented operation notes for the existing NSSM deployment.
- Windows test fixes so `cmd/cc-connect` package tests pass with `-tags no_web`.

## Runtime Validation

Validated locally on Windows service mode:

- NSSM service: `cc-connect-codex-feishu` running as Automatic.
- Runtime binary deployed at `F:\development\cc-connect-service\cc-connect.exe`.
- API socket: `F:\development\cc-connect-service\data\run\api.sock`.
- Feishu decision card receives button and text comment.
- Six-choice decision card displays as two rows instead of truncating labels.
- Resolved cards are replaced with a no-button result card.
- Dedup smoke: first event creates a card; second identical `event-key/fingerprint` returns `notification=deduped`.
- `decision ask --config F:\development\cc-connect-service\config.toml` resolves the service socket and returns deduped for an existing event.
- Codex automation巡检 can send a Feishu decision and, after `decision ask --wait` returns, uses Codex thread tooling to回写决策到目标线程.

Important boundary:

- cc-connect resolves the Feishu decision back to the caller of `decision ask --wait`.
- It does not directly control arbitrary Codex Desktop threads. Cross-thread watchdog flows must explicitly forward the returned choice/comment with Codex thread tools such as `send_message_to_thread`.

## Verification

```text
go test -tags no_web ./cmd/cc-connect -run 'TestResolveSocketPath|TestParseDecisionAskArgs|TestParseWatchdogCheckpointArgs' -count=1
go test -tags no_web ./platform/feishu -run 'TestBuildDecisionCardPayload|TestBuildDecisionCardSplitsManyActionsIntoRows|TestRenderCardMap_EqualColumnsActionsUseColumnSet|TestRenderCardMap_TwoEqualColumnsUseBisectAndCenteredButtons' -count=1
go test -tags no_web ./core -run 'TestDecision|TestNotification|TestHandleSend'
go build -buildvcs=false -tags no_web ./cmd/cc-connect
git diff --check
```

`feishu-watchdog` user skill validation also passed locally.

## Remaining Operational Note

The deployed local service config contains Feishu credentials. The `app_secret` should be rotated in Feishu and updated in the runtime `config.toml` before treating the local deployment as clean from a security perspective.
