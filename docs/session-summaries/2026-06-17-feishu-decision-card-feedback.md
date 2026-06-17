## 2026-06-17 - Feishu decision card feedback recovery

### Key Information
- Symptom: after clicking a Feishu decision card, the card only showed `决策已收到` / `已记录本次选择。`; before the recent redesign it also showed the selected decision result and comment.
- Root cause: `platform/feishu/feishu.go` handled `decision:respond` by resolving the decision and then returning a fixed confirmation card. The callback already extracted `comment` / `decision_comment`, but the returned Feishu card did not render the selected choice or comment.
- Runtime check: the callback path was not fully broken; `F:\development\cc-connect-service\data\decisions\decisions.json` showed responses such as `choice=ignore`, proving the click reached the decision store.
- Fix: `platform/feishu/feishu.go` now renders `选择：<localized choice>` and, when present, `备注：<comment>` in the returned card after successful decision resolution.
- Runtime deployment: rebuilt `F:\development\cc-connect-service\cc-connect.exe` from this repo and restarted Windows service `cc-connect-codex-feishu`.
- Runtime verification after restart: binary timestamp `2026/6/17 8:29:28`, service process start `2026/6/17 8:29:50`, logs showed `platform ready`, `api server started`, and Feishu WebSocket connected.

### Important Information
- Existing in-progress Feishu changes were preserved:
  - `platform/feishu/card.go`: common English decision choices map to Chinese labels, e.g. `approve` -> `同意`, `reject` -> `拒绝`.
  - `platform/feishu/feishu.go`: callback extraction supports nested maps under `value`, `input_value`, and `form_value`.
  - `platform/feishu/platform_test.go`: nested `FormValue.value` callback regression test.
- Added regression coverage:
  - `TestInteractivePlatform_DecisionActionResolvesWithComment` now asserts the callback card response includes `决策已收到`, `选择：继续`, and `备注：Use proxy if slow.`
  - `TestDecisionChoiceLabelLocalizesCommonEnglishChoices` covers common English choice localization.

### Verification
- Red test before fix: `go test -tags no_web ./platform/feishu -run TestInteractivePlatform_DecisionActionResolvesWithComment -v` failed because card response lacked `选择：继续`.
- Passing after fix:
  - `go test -tags no_web ./platform/feishu -run TestInteractivePlatform_DecisionActionResolvesWithComment -v`
  - `go test -tags no_web ./platform/feishu`
  - `go test -tags no_web ./core -run 'TestDecision|TestAPI.*Decision|TestHandleDecision'`
  - `go test -tags no_web ./cmd/cc-connect -run 'TestDecision|TestFormatDecision|TestWaitForDecision'`
  - `git diff --check -- platform/feishu/feishu.go platform/feishu/platform_test.go platform/feishu/card.go platform/feishu/card_test.go`
- Three-round review found no blocking issues. Residual note: the broader gate `go test -tags no_web ./core ./config ./platform/feishu ./cmd/cc-connect` still hits an existing Windows path expectation in `workspace_state_test.go`, unrelated to this Feishu card feedback path.

### Follow-ups
- If another Feishu decision display regression appears, first check `decisions.json` to distinguish callback/decision-store failure from card-rendering failure.
- Keep runtime verification paired with source fixes: rebuild, replace `F:\development\cc-connect-service\cc-connect.exe`, restart `cc-connect-codex-feishu`, then verify process start time and `platform ready` / `api server started` logs.

### Dropped Noise
- Omitted repeated status updates, full raw logs, and intermediate assistant speculation. No credentials or secret values were preserved.
