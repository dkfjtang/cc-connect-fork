# 2026-06-16 - Feishu Notify User Receiver ID Fix

## Key Information

- Repository: `F:\development\cc-connect-fork`.
- Runtime service: `cc-connect-codex-feishu`, NSSM-managed Windows service.
- Runtime directory: `F:\development\cc-connect-service`.
- Runtime config: `F:\development\cc-connect-service\config.toml`.
- Symptom: automated Codex session watchdog/decision send failed with "cc-connect 返回接收人 ID 校验失败，未成功通知云仓线程的 waitingOnApproval 状态".
- Root cause: `[notify.feishu].default_user_id` in runtime config was set to `"*"`. The Feishu adapter passed that value to `Im.Message.Create` as `ReceiveIdTypeOpenId`, so Feishu rejected `*` as an invalid receiver ID.
- Current verified Feishu App user open_id: `ou_c89ae4c66d6445c72ebf8ef2fa113e84`.
- Runtime config was backed up to `F:\development\cc-connect-service\config.toml.bak-20260616-cc-connect-notify-user`.
- Runtime config was updated to:
  ```toml
  [notify.feishu]
  default_user_id = "ou_c89ae4c66d6445c72ebf8ef2fa113e84"
  ```

## Important Information

- Service was restarted after the runtime config change.
- `sc.exe queryex cc-connect-codex-feishu` showed the service running after restart, PID `25572` at the time of verification.
- Verification command:
  ```powershell
  F:\development\cc-connect-service\cc-connect.exe decision ask --config F:\development\cc-connect-service\config.toml --title "巡检通知验证" --message "验证 default_user_id 修复后是否能发送决策卡片。" --choices continue,stop --recommended continue --timeout-mins 5
  ```
- Verification result: command returned `dec_469e55bce69e152e`.
- Persistence check: `F:\development\cc-connect-service\data\decisions\decisions.json` contained `dec_469e55bce69e152e`, title `巡检通知验证`, and `notified: true`.
- User screenshot confirmed the decision card rendered in Feishu and `/whoami` showed the same User ID, Chat ID, and session key.

## Code Changes

- `platform/feishu/feishu.go`: added `normalizeFeishuNotifyUserID`, treating `notify_user_id/default_user_id = "*"` as unconfigured so it is not sent as a Feishu open_id.
- `platform/feishu/feishu.go`: after normalization, fallback still uses exactly one explicit `allow_from` user via `singleFeishuAllowFromUser`.
- `platform/feishu/platform_test.go`: added regression tests:
  - `TestNew_NotifyWildcardFallsBackToSingleAllowFrom`
  - `TestNew_DefaultUserWildcardDoesNotBecomeNotifyUser`

## Verification Limits

- Go tests were not executed in this environment because `go` was not available on PATH and common local Go install paths were absent.
- The intended focused test command once Go is available:
  ```powershell
  go test ./platform/feishu -run 'TestNew_(NotifyWildcardFallsBackToSingleAllowFrom|DefaultUserWildcardDoesNotBecomeNotifyUser)' -v
  ```

## Follow-ups

- The `/whoami` card currently says the User ID can be used for `allow_from` and `admin_from`; it should also mention `[notify.feishu].default_user_id`.
- The repository already had unrelated dirty changes in decision/watchdog files before this fix; do not treat this session's code change as owning all files in `git status`.
- Consider reverting temporary Feishu inbound/routed log elevation from `Info` back to `Debug` after diagnostics are closed.

## Dropped Noise

- Repeated PowerShell quoting failures were not preserved except as the practical lesson to prefer `apply_patch` or here-strings for quoted TOML edits.
- No Feishu app secret, access token, local API token, or raw long Feishu payload was stored.
