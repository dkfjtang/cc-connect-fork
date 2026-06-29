# 2026-06-29 - Feishu Decision Field Format Review

## Key Information

- User clarified the scope: button design was acceptable; only decision-card content text layout needed to return closer to the previous field-based Feishu card style.
- Implemented source change in `platform/feishu/card.go`: natural-language decision prompts are now formatted into separate markdown fields such as `线程：`, `最近进展：`, `需要用户决策：`, `建议动作：`, `注意事项：`, `其他选项：`, and `备注：`.
- Existing explicit labeled prompts remain protected by `hasDecisionMessageLabelPrefix`, so old `线程标题：/判断类型：/最近进展：/需要用户决策：/建议动作：` messages keep their established rendering.
- The change does not alter decision button layout, choice values, callbacks, or acknowledgement-card response shape.

## Important Information

- Added regression coverage in `platform/feishu/card_test.go` for:
  - `目标线程 ... 建议选择 ...；不要 ...`
  - screenshot-like `线程 019f02ef ... 推荐 continue ...；备注为 ...`
  - legacy natural-language `线程 019f03d9 ... 建议 continue ...；pause ...`
- Added acknowledgement-card coverage in `platform/feishu/platform_test.go`, including the exact owner-decision prompt shape after a user clicks a choice.
- Expert review result:
  - Product/display review: accepted the direction as matching the user's scope.
  - Code review: no Critical or Major findings; noted only heuristic parser limitations.
  - Test review: initially Conditional Pass; the missing owner-prompt acknowledgement assertion was added and verified.

## Verification

- Pre-commit and post-merge verification:
  - `C:\Users\Administrator\.cache\go-toolchain\go\bin\go.exe test -count=1 -tags no_web ./platform/feishu` passed.
  - `git diff --check -- platform/feishu/card.go platform/feishu/card_test.go platform/feishu/platform_test.go` passed.
- Additional check attempted earlier:
  - `go test -tags no_web ./platform/feishu ./core` exposed an existing Windows path expectation failure in `core/workspace_state_test.go:113`; it was unrelated to the Feishu formatter change.

## Delivery

- Commit created on `main`: `af7889f7 fix(feishu): format decision prompts as fields`.
- `origin/main` was fetched and merged; it was already up to date before push.
- Pushed `main` to `origin` successfully; local and remote now point to `af7889f7`.

## Follow-ups

- Runtime deployment is still separate: the committed source has not yet been rebuilt into `F:\development\cc-connect-service\cc-connect.exe`, service-restarted, or verified with a live Feishu card screenshot.
- Parser remains heuristic. Future prompt variants using `建议：`, English punctuation, or no `线程 `/`目标线程 ` prefix may fall back to ordinary split text rather than full field labels.

## Dropped Noise

- Repeated screenshot-review discussion and PowerShell quoting failures were not preserved beyond the useful command/verification conclusions above.
