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
  --choices "continue,abort,revise" \
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

## Known Boundaries

- This does not inspect or control unrelated Codex sessions.
- The active session must voluntarily call the command.
- Real Feishu callback behavior should still be smoke-tested on the user's machine after deployment.
- Background cleanup is access-driven in the current decision store; long-lived daemon operators should monitor memory if decision requests are created and never read.
