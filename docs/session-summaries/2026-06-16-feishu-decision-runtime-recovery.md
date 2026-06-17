# 2026-06-16 - Feishu Decision Runtime Recovery

## Key Information

- Repository: `F:\development\cc-connect-fork`.
- Runtime service: `cc-connect-codex-feishu`.
- Runtime binary path: `F:\development\cc-connect-service\cc-connect.exe`.
- Reported symptom after code fixes:
  - Feishu decision buttons still rendered English labels.
  - Clicking a button did not visibly change the card state.
- Root cause confirmed during this session:
  - Source code had been patched, but the Windows service was still running the old `cc-connect.exe` from `2026/6/16 12:19:07`.
  - Test cards sent before the service binary replacement were therefore generated and handled by stale runtime code.
- Recovery result:
  - Rebuilt `cc-connect.exe` with the local Go toolchain at `C:\Users\Administrator\.cache\go-toolchain\go\bin\go.exe`.
  - Replaced service binary with new file timestamp `2026/6/16 21:32:22`, length `18129408`.
  - Restarted `cc-connect-codex-feishu`; service came up with `platform ready`, `api server started`, and Feishu WebSocket connected.

## Important Information

- Code changes involved in the recovery:
  - `platform/feishu/card.go`: expanded decision label localization for common choices such as `approve`, `reject`, `cancel`, `retry`, `skip`, `done`.
  - `platform/feishu/feishu.go`: decision callback string parsing now checks nested callback maps under `value`, `input_value`, and `form_value`.
  - `platform/feishu/card_test.go`: added label coverage for common English decision choices.
  - `platform/feishu/platform_test.go`: added nested `form_value.value` decision callback regression coverage.
- Go toolchain was available but not on PATH:
  - `C:\Users\Administrator\.cache\go-toolchain\go\bin\go.exe`.
- Targeted tests passed before runtime replacement:
  - `go test -tags no_web ./platform/feishu -run 'TestBuildDecisionCardLocalizesKnownChoiceLabels|TestDecisionChoiceLabelLocalizesCommonEnglishChoices|TestInteractivePlatform_DecisionActionReadsPayloadFromFormValue|TestInteractivePlatform_DecisionActionReadsPayloadFromNestedFormValue|TestInteractivePlatform_DecisionActionReadsPayloadFromSubmitName' -count=1`
  - `go test -tags no_web ./cmd/cc-connect -run 'TestParseDecisionAskArgs|TestParseDecisionAskArgsSetsScopeFromEnvironment' -count=1`
  - `go test -tags no_web ./core -run 'TestDecision|TestHandleSend|TestHandleDecision' -count=1`

## Verification Evidence

- Service after restart:
  - Process `cc-connect` running from `F:\development\cc-connect-service\cc-connect.exe`.
  - Process start time: `2026/6/16 21:35:24`.
  - NSSM wrapper also running from `F:\development\cc-connect-fork\deploy\windows-service\bin\nssm.exe`.
- Feishu callback evidence after restart:
  - Log received `card.action.trigger` at `2026/06/16 21:35:43`.
  - Callback action contained a submit name with encoded payload:
    - `decision_submit_v1_6465635f66626366653464393532366133313831_69676e6f7265`
  - This decoded to decision `dec_fbcfe4d9526a3181` and choice `ignore`.
- Decision store evidence:
  - `F:\development\cc-connect-service\data\decisions\decisions.json` recorded response:
    - `decision_id`: `dec_fbcfe4d9526a3181`
    - `choice`: `ignore`
    - `notified`: `true`

## Reusable Lessons

- For Feishu decision card regressions, check runtime alignment before deeper code debugging:
  - Confirm `F:\development\cc-connect-service\cc-connect.exe` timestamp and length.
  - Confirm `cc-connect-codex-feishu` process start time and binary path.
  - Confirm logs show restart lines: `platform ready`, `api server started`, and WebSocket connected.
- If buttons still show old labels after source patches, suspect stale runtime binary first.
- For click/no-response issues, inspect `card.action.trigger` logs and `decisions.json` before assuming callback parsing is broken.
- NSSM wraps the service; stopping the Windows service may leave or restart child state. Confirm both `nssm` and `cc-connect` processes when replacing the binary.

## Open Follow-ups

- Commit the current code changes if this recovery should be persisted in the repo history.
- Consider adding a lightweight runtime version/build-time command or log line so stale binary issues are easier to identify.
- Decide whether to remove or resolve any prior untracked session summary if it is superseded by this recovery record.

## Dropped Noise

- Repeated PowerShell quoting mistakes and failed variable interpolation attempts were not preserved beyond the operational lesson to verify runtime state.
- Raw Feishu callback payloads were summarized without preserving tokens or unrelated long event data.
