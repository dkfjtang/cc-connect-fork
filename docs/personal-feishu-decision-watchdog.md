# Personal Feishu Decision Watchdog

This guide describes the personal, single-user Feishu decision loop for local Codex long tasks.

The design is session-driven: the Codex session that is doing the work calls cc-connect when it needs a decision. cc-connect does not monitor or control other Codex sandboxes.

## Phase 1: Decision Request MVP

Configure the personal Feishu recipient:

```toml
[notify.feishu]
default_user_id = "ou_xxx"
```

The user ID should be the same Feishu User ID shown by `/whoami` or `/status`, and it should already be accepted by the Feishu platform's `allow_from` or admin settings.

Start cc-connect normally, then verify the loop from a local shell:

```bash
cc-connect decision ask \
  --title "需要确认" \
  --message "测试失败，是否继续按当前方案修复？" \
  --choices "continue,abort,revise,ignore,remind_later,reconnect" \
  --recommended continue \
  --event-key "smoke:decision" \
  --event-fingerprint "test-failure-v1" \
  --cooldown-mins 30 \
  --timeout-mins 30 \
  --wait
```

Expected result:

```text
choice=continue
comment="继续，先不要改生产配置"
```

Acceptance criteria:

- Feishu receives a private card.
- The card has buttons and an optional text field.
- Clicking a button resolves the waiting CLI command.
- The CLI prints `choice=...` and `comment="..."`.

Scope note:

- `decision ask --wait` returns the decision only to the process that called it.
- When a Codex automation is watching a different Codex thread, cc-connect does not directly control that target thread. The automation must take the returned `choice` and `comment`, then call the Codex thread tool such as `send_message_to_thread` for the target thread.

On Windows, the smoke script checks the local binary and config before sending the request:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\smoke\feishu_watchdog_smoke.ps1 `
  -CcConnect .\cc-connect.exe `
  -Config C:\Users\<you>\.cc-connect\config.toml
```

Use `-NoWait` if you only want to verify that a decision ID is created without blocking for the Feishu button click.

## Phase 2: Codex Trigger Rules

Codex should call the decision command instead of asking the user to stay at the computer.

Use `cc-connect decision ask --wait` when the session reaches any of these points:

- A human decision is needed to choose between viable implementation plans.
- A task is blocked by missing credentials, external account state, permissions, or production risk.
- A destructive, irreversible, or high-risk command would be the next step.
- A test or deployment failure has multiple reasonable recovery paths.

For ordinary long-running work, use the watchdog checkpoint command:

```bash
cc-connect watchdog checkpoint \
  --task "<short task name>" \
  --summary "<current state and decision needed>" \
  --elapsed-mins <minutes> \
  --threshold-mins 10 \
  --event-key "<thread-or-task>:checkpoint" \
  --event-fingerprint "<last-turn-or-status-hash>" \
  --cooldown-mins 30 \
  --wait
```

The default watchdog choices are:

- `continue`: continue the current plan.
- `pause`: stop and leave a concise status report.
- `revise`: incorporate the user's text comment as the new direction.
- `ignore`: ignore this notification only.
- `remind_later`: keep the task paused and re-notify later.
- `reconnect`: wake or reattach the current session before proceeding.

## Phase 3: Long Task Watchdog

The first watchdog implementation is an explicit checkpoint command. It avoids cross-session monitoring and therefore works within Codex sandbox boundaries.

Command behavior:

- If `--elapsed-mins` is lower than `--threshold-mins`, it prints `watchdog=skipped` and does not notify Feishu.
- If the threshold is reached, it sends a personal Feishu decision card.
- With `--wait`, it blocks until the user chooses an option or the request times out.
- Without `--wait`, it prints the decision ID and returns.
- With `--event-key`, `--event-fingerprint`, and `--cooldown-mins`, repeated monitors can suppress duplicate Feishu notifications for the same unchanged event.

Deduplication guidance:

- Use a stable `event-key` such as `<thread-id>:blocked`, `<thread-id>:decision`, `<thread-id>:interrupted`, or `<task-name>:checkpoint`.
- Use `event-fingerprint` for the content that must change before notifying again, such as the latest turn ID, last message hash, error hash, or status summary hash.
- Use `--cooldown-mins 30` for the default 15-minute巡检 cadence, so only two consecutive unchanged巡检 cycles can escalate.
- If the CLI prints `notification=deduped`, treat it as a successful no-op, not a failure.

Recommended thresholds:

- Default long-task check: 10 minutes.
- Normal decision timeout: 30 minutes.
- High-risk operations: do not auto-continue without a positive user choice.

Recommended Codex behavior after a choice:

- `continue`: proceed with the current plan.
- `pause`: stop work and summarize current state, pending actions, and how to resume.
- `revise`: treat the Feishu comment as updated user instruction and continue accordingly.

For cross-thread watchdog automations, do not stop after the Feishu card is resolved. After a non-deduped decision returns, send an explicit follow-up prompt to the target Codex thread with the selected choice and comment. Only then report the巡检 summary in the watchdog thread.

## Known Boundaries

- This does not inspect or control unrelated Codex sessions.
- The active session must voluntarily call the command.
- Cross-thread巡检 requires Codex's own thread tools to forward the user's decision to the target thread.
- Real Feishu callback behavior should still be smoke-tested on the user's machine after deployment.
- Background cleanup is access-driven in the current decision store; long-lived daemon operators should monitor memory if decision requests are created and never read.

## Windows Service Operations

The personal watchdog can run as an NSSM-managed Windows service so Codex sessions and Codex automations can call the same long-lived cc-connect API.

Recommended local service layout:

```text
Service name: cc-connect-codex-feishu
Runtime dir:  F:\development\cc-connect-service
Binary:       F:\development\cc-connect-service\cc-connect.exe
Config:       F:\development\cc-connect-service\config.toml
Data dir:     F:\development\cc-connect-service\data
API socket:   F:\development\cc-connect-service\data\run\api.sock
Out log:      F:\development\cc-connect-service\logs\cc-connect.out.log
Err log:      F:\development\cc-connect-service\logs\cc-connect.err.log
Ledger:       F:\development\cc-connect-service\data\notifications\ledger.json
```

Check service state:

```powershell
Get-Service -Name cc-connect-codex-feishu
```

Restart after replacing the binary:

```powershell
Restart-Service -Name cc-connect-codex-feishu
```

Confirm the API socket and Feishu connection:

```powershell
Get-Item -LiteralPath F:\development\cc-connect-service\data\run\api.sock
Get-Content -LiteralPath F:\development\cc-connect-service\logs\cc-connect.out.log -Tail 80
```

Deduplication smoke test:

```powershell
$exe = 'F:\development\cc-connect-service\cc-connect.exe'
$config = 'F:\development\cc-connect-service\config.toml'
$key = 'smoke-dedup:<unique-id>'

& $exe decision ask --config $config `
  --title '去重验证' `
  --message '第一次应该发卡' `
  --choices continue,pause,revise,ignore,remind_later,reconnect `
  --event-key $key `
  --event-fingerprint 'turn-1' `
  --cooldown-mins 30

& $exe decision ask --config $config `
  --title '去重验证' `
  --message '第二次应该去重' `
  --choices continue,pause,revise,ignore,remind_later,reconnect `
  --event-key $key `
  --event-fingerprint 'turn-1' `
  --cooldown-mins 30
```

Expected second output:

```text
notification=deduped
event_key="smoke-dedup:<unique-id>"
event_fingerprint="turn-1"
```

If duplicate Feishu cards appear for the same event:

- Confirm the service binary is newer than the deduplication change.
- Confirm the automation passes `--event-key`, `--event-fingerprint`, and `--cooldown-mins`.
- Confirm `ledger.json` exists under the configured `data_dir`.
- Treat old cards created before the service update as historical; deduplication does not remove cards that were already sent.

If the CLI reports `cc-connect is not running`:

- Check the NSSM service state.
- Prefer passing `--config F:\development\cc-connect-service\config.toml`; the CLI reads `data_dir` from that file to locate the API socket.
- If using `--data-dir`, confirm it matches `data_dir` in `config.toml`.
- Confirm the API socket exists under `<data_dir>\run\api.sock`.

Operational security:

- Do not print Feishu `app_secret` in logs, screenshots, or support messages.
- If `app_secret` was exposed during troubleshooting, rotate it in Feishu and update `config.toml`.
- Back up `ledger.json` with the service data directory if suppressing duplicate notifications across service restarts matters.
