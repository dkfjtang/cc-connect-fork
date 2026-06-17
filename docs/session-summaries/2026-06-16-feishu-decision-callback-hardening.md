# 2026-06-16 - Feishu Decision Callback Hardening

## Key Information

- Repository: `F:\development\cc-connect-fork`.
- Final commit pushed to `origin/main`: `16fa27f5 fix: harden Feishu decision callbacks`.
- Triggering symptoms:
  - Feishu decision/watchdog cards rendered decision buttons in English (`continue`, `pause`, `revise`, `ignore`, `remind_later`, `reconnect`, `stop`).
  - Clicking a decision button could leave the button grey/loading without completing the decision response.
- Final main state after push:
  - `main` aligned with `origin/main`.
  - `git branch --all --verbose --no-abbrev` showed only local `main` and remote `origin/main`.
  - `git status --short --branch` showed a clean main worktree.

## Important Information

- Main code changes:
  - `platform/feishu/card.go`: localized known decision labels to Chinese while preserving machine choices in callback payloads.
  - `platform/feishu/card.go`: changed decision submit button names to a lossless fallback protocol: `decision_submit_v1_<hex(decision_id)>_<hex(choice)>`.
  - `platform/feishu/feishu.go`: decision card callbacks now read payloads from `Action.Value`, `Action.FormValue`, or lossless `Action.Name`.
  - `platform/feishu/feishu.go`: decision callback success and error user-facing messages were localized to Chinese.
  - `platform/feishu/feishu.go`: only `decision_submit_v1_` names are treated as decision fallback callbacks, avoiding accidental resolution of legacy `decision_submit_0`.
- Regression tests added/updated:
  - Chinese label rendering and machine value preservation.
  - `abort` label coverage.
  - name-only callback fallback with `remind_later`.
  - custom choice fallback with `approve-now`.
  - legacy `decision_submit_0` without payload does not call the decision responder.
  - structured assertions now inspect form buttons, text, values, and names instead of relying only on raw JSON string containment.

## Review Results

- User requested 3 independent cross-agent review rounds after the initial fix.
- Review round 1 found blocking issues:
  - submit-name fallback was not lossless.
  - fallback only supported a fixed choice set.
  - legacy card compatibility evidence was insufficient.
- Review round 2 found no blocker, but flagged:
  - fallback ID assumptions.
  - English error toast messages.
  - unrelated `Debug` to `Info` log elevation risk.
- Review round 3 found blocking issues:
  - broad worktree changes outside the narrow Feishu card fix.
  - fixed-choice submit-name fallback.
  - localization test missing `abort`.
- Blocking review feedback was addressed before commit `16fa27f5`.

## Verification

- Passed:
  - `rtk git diff --check`.
  - `rtk git diff --check -- platform/feishu/card.go platform/feishu/card_test.go platform/feishu/feishu.go platform/feishu/platform_test.go`.
- Not run:
  - Go tests were not executed in this environment because `go` / `go test` was not available on PATH.
- Intended validation when Go is available:
  ```powershell
  go test -tags no_web ./core ./config ./platform/feishu ./cmd/cc-connect
  ```
- Evidence still missing:
  - A real Feishu `card.action.trigger` callback sample for `form_action_type=submit`, especially the exact shape of `Action.Value`, `Action.FormValue`, and `Action.Name`.

## Worktree And Branch Cleanup

- Pushed `main` to `origin/main`.
- Removed clean detached review worktree:
  - `F:\development\cc-connect-fork\.codex-tmp\review-pr1`.
- Ran `git worktree prune`.
- Preserved detached worktree because it contains uncommitted changes:
  - `C:\tmp\cc-connect-feishu-layout-fix`
  - Dirty files:
    - `platform/feishu/card.go`
    - `platform/feishu/card_test.go`
- No local feature branches remained to delete.

## Open Follow-ups

- Run the intended Go validation command in an environment with Go installed.
- Capture or inspect a real Feishu decision button callback payload to confirm the fallback path matches production behavior.
- Decide whether to revert temporary Feishu inbound/routed log elevation from `Info` back to `Debug` after diagnostics are no longer needed.
- Review or archive the dirty detached worktree `C:\tmp\cc-connect-feishu-layout-fix` before deleting it.

## Dropped Noise

- Repeated PowerShell quoting errors and long intermediate status updates were not preserved.
- No Feishu app secrets, tokens, local API credentials, or raw long Feishu callback payloads were stored.
