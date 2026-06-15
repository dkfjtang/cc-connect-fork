# Personal Feishu Decision Watchdog Design

**Date:** 2026-06-15
**Status:** Implemented
**Scope:** Single-user local Codex sessions that need remote notification and decision input while the user is away from the computer.

## Problem

The user normally starts and drives Codex sessions from the local desktop, not from Feishu. Long-running goal work can continue after the user leaves the computer. When a task needs confirmation, hits a blocker, or runs longer than expected, the user needs a Feishu private-message notification and a way to send a decision back to the waiting local Codex session.

The previous "reply to the original Feishu conversation" model does not apply because these tasks were not initiated from Feishu and therefore have no Feishu `replyCtx`.

## Goals

1. Let local Codex sessions request remote decisions through cc-connect without knowing Feishu API details.
2. Send notifications to one configured personal Feishu recipient by default.
3. Let the local Codex process block on a `decision ask --wait` command and receive the user's Feishu decision as command output.
4. Support explicit unattended mode, Codex goal mode, and long-running task mode as triggers.
5. Keep the MVP personal-only: no group routing, multi-user routing, or project-specific target matrix.

## Non-Goals

- Monitoring or controlling arbitrary Codex sessions from inside another sandboxed Codex session.
- Group chat routing, team approvals, escalation chains, or per-project owner routing.
- Guaranteeing that Feishu is always reachable. The system should detect failures, retry, and surface status, but it cannot guarantee external network or Feishu availability.
- Replacing Codex's native sandbox or approval policy.

## User Model

The configured user is the only remote decision maker. The notification target should reuse the Feishu user ID that is already proven to work with the user's current cc-connect bot configuration, such as the existing `allow_from` / `/whoami` user ID shape:

```toml
[notify.feishu]
default_user_id = "ou_xxx"
```

The MVP reuses the existing Feishu user identifier shape that is already proven to work in the user's current cc-connect setup. No new bind/discovery flow is required for the first implementation.

If a dedicated notify target is absent, the implementation may fall back to a single non-wildcard Feishu `allow_from` value when exactly one Feishu platform is configured. Wildcard `allow_from = "*"` must not be used as a personal notification target.

## Trigger Model

The decision watchdog should be available through three entry points:

1. **Explicit unattended request:** the user says they are leaving, asks for unattended execution, or asks Codex to call them on Feishu when a decision is needed.
2. **Goal mode:** when work is framed as a persistent goal or long objective, Codex should treat decision points as remote-callable.
3. **Long task mode:** after a configured threshold, cc-connect may send a status update. This is a notification, not necessarily a decision request.

Recommended defaults:

```toml
[watchdog]
enabled = true
long_task_notify_mins = 10
decision_reminder_mins = 20
```

## Architecture

```text
Local Codex session
  -> cc-connect decision ask --wait
  -> local cc-connect API socket
  -> decision store
  -> Feishu private message/card
  -> user decision in Feishu
  -> cc-connect resolves pending decision
  -> CLI prints decision result to Codex
```

### Components

1. **CLI command**
   - New command family: `cc-connect decision`.
   - MVP command: `cc-connect decision ask --title <text> --message <text> --choices <csv> --wait`.
   - Reads local cc-connect socket like `send`, `cron`, and `relay`.
   - Blocks until a decision arrives, timeout expires, or the daemon exits.

2. **Core API**
   - Add local API endpoints under the existing Unix socket API.
   - Proposed endpoints:
     - `POST /decision/ask`
     - `POST /decision/respond`
     - `GET /decision/{id}`
   - Store pending decisions in memory plus a small persisted file under `data_dir/decisions` so daemon restarts do not lose active prompts.

3. **Feishu notifier**
   - Send a private Feishu message or interactive card to the configured personal target.
   - The card should include title, current state, recommended action, choices, and optional free-form reply guidance.
   - Button actions call back into the existing Feishu card action path and resolve the pending decision.

4. **Prompt/skill integration**
   - `AGENTS.md` should contain short default trigger rules.
   - A repo or user skill should contain the detailed workflow for unattended decisions.
   - Codex should call the CLI command when it reaches a decision point instead of describing the need for confirmation only in text.

## Decision Payload

Minimum request:

```json
{
  "title": "Need confirmation",
  "message": "The build failed because dependency X is missing. Install it?",
  "choices": ["continue", "abort", "revise"],
  "recommended": "continue",
  "timeout_mins": 30
}
```

Minimum response:

```json
{
  "decision_id": "dec_...",
  "choice": "continue",
  "comment": "Use the local proxy if the download is slow."
}
```

CLI output should be easy for Codex to parse:

```text
choice=continue
comment=Use the local proxy if the download is slow.
```

## Reliability

1. **Daemon requirement:** decision commands require a running cc-connect daemon. If the socket is missing, the CLI should fail clearly.
2. **Retry:** Feishu send failures should use bounded retry with exponential backoff. Pending decisions remain visible in local state.
3. **Restart recovery:** persisted pending decisions should be reloaded on daemon start. The daemon may resend unresolved prompts with a clear "restored pending decision" marker.
4. **Reminder:** unresolved decisions can be reminded after `decision_reminder_mins`.
5. **Idempotency:** Feishu card actions must be idempotent. The first valid response wins; later responses report that the decision is already resolved.
6. **Default wait:** `decision ask --wait` defaults to 30 minutes. This is long enough for the user to notice and answer a Feishu private message while away from the desk, but short enough to avoid leaving local Codex processes blocked indefinitely. Users can override it per request.
7. **First implementation scope:** long-task status notifications are deferred. The first implementation only covers explicit decision prompts and waiting for the user's decision.

## Safety

- The notification target is personal-only for MVP.
- Only locally authenticated cc-connect commands can create decisions.
- Feishu responses must match an existing pending decision ID and a configured token/action payload.
- Sensitive data should be summarized before sending. The AGENTS guidance should tell Codex not to include secrets, tokens, or full `.env` contents in decision messages.
- The command should support a timeout so a local Codex process does not wait forever unless explicitly requested.

## UX

MVP command:

```powershell
cc-connect decision ask --title "需要确认" --message "测试失败，需要改方案吗？" --choices "continue,abort,revise" --wait
```

Example output:

```text
choice=revise
comment=先不要改生产配置，只修测试夹具。
```

Recommended user-facing Codex phrase:

```text
无人值守执行，有需要确认的地方飞书叫我。
```

Feishu interaction supports card buttons for the decision choice and an optional card text input for comments. The waiting CLI receives both fields as line-oriented output.

## Open Decisions

1. Exact existing Feishu config field name to reuse for the personal recipient.
2. Whether the optional text comment should be captured via Feishu card input, reply-to-card text, or both.

## Implementation Order

1. Confirm the existing Feishu personal recipient config field and send path.
2. Add config fields for `notify.feishu.default_user_id` and watchdog defaults.
3. Add core decision store and local API endpoints.
4. Add `cc-connect decision ask --wait`.
5. Add Feishu private notification and button response handling.
6. Add tests for parsing, API lifecycle, idempotent response, timeout, and missing daemon/config errors.
7. Add AGENTS/skill guidance after the command is available.

Long-task status updates are intentionally deferred to a second step after decision prompts work end-to-end.
