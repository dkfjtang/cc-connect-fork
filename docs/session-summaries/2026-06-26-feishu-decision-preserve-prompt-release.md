## 2026-06-26 - Feishu decision prompt preservation release

### Key Information
- Scope: fix Feishu decision card callback so clicking a decision preserves the original waiting-decision prompt content instead of replacing the whole card with only conclusion and comment.
- Repository: `F:\development\cc-connect-fork`, branch `main`.
- Commit pushed: `c44bb9ab fix: preserve Feishu decision prompt after response`, pushed to `origin/main`.
- Changed source files:
  - `core/api.go`
  - `core/api_test.go`
  - `core/interfaces.go`
  - `platform/feishu/feishu.go`
  - `platform/feishu/platform_test.go`
- Final design: `core.DecisionResponder` returns `DecisionRecord`; `APIServer.ResolveDecision` resolves the response, then reloads the persisted decision record from `DecisionStore.Get`; Feishu `decision:respond` callback builds the acknowledgement card from the returned persistent record.
- API compatibility decision: `POST /decision/respond` success response keeps top-level `status:"ok"` and also returns `decision` plus `response`, so old status-only callers remain compatible while Feishu can render the original prompt.

### Review And Fix Rounds
- Initial in-memory snapshot design was rejected because service restart could lose the original waiting-decision content.
- Persistent-record design replaced it and added a reload regression test.
- Independent code review found no functional blocker but flagged `/decision/respond` response-body compatibility risk.
- Compatibility patch added `decisionRespondResponse{status, decision, response}` and corresponding API test assertion.
- Final independent code review accepted the compatibility patch and concluded the change was mergeable.
- Independent ops/test review confirmed positive runtime evidence but required explicit binary-source hash proof and noted that visual Feishu click was not manually confirmed in this session.

### Verification Evidence
- `gofmt` ran on modified Go files.
- Passed targeted tests:
  - `go test -count=1 -tags no_web ./core -run 'TestDecision(API|Store)|TestPersistentDecision|TestHandleDecision'`
  - `go test -count=1 -tags no_web ./platform/feishu`
  - `go test -count=1 -tags no_web ./cmd/cc-connect -run 'TestParseDecision|TestFormatDecision|TestResolveSocketPath'`
  - `git diff --check`
- Known unrelated failure remains: broader `go test -count=1 -tags no_web ./core` fails on Windows path normalization in `workspace_state_test.go:113`; this was not introduced by this change.
- Final runtime API proof used UTF-8 without BOM request bodies through socket `F:\development\cc-connect-service\data\run\api.sock`.
- Final runtime decision proof: `/decision/ask` then `/decision/respond` returned `FINAL_RUNTIME_DECISION_RESPOND_RECORD_OK dec_34980006086fe9c0`; response included `status:"ok"`, original Chinese `decision.message`, `response.choice=continue`, and comment `最终API复验备注：保留原内容`.

### Release Evidence
- Built final Windows binary:
  - `F:\development\cc-connect-fork\dist\cc-connect-v1.3.3-beta.4-windows-amd64.exe`
  - build time `2026-06-26 22:51:09`
  - SHA256 `AD5D5756560322166A22D1F2D76CCFBB9CDBB220D539AB6A83489C34830FD092`
- Deployed runtime binary:
  - `F:\development\cc-connect-service\cc-connect.exe`
  - SHA256 `AD5D5756560322166A22D1F2D76CCFBB9CDBB220D539AB6A83489C34830FD092`
- Runtime backup before final replacement:
  - `F:\development\cc-connect-service\cc-connect.exe.bak-20260626-225135`
- Service restarted:
  - service `cc-connect-codex-feishu`
  - process `F:\development\cc-connect-service\cc-connect.exe`
  - process start time `2026-06-26 22:51:38`
- Startup log after final deployment showed `platform ready`, `api server started`, `cc-connect is running`, and Feishu WebSocket connected.

### Risks And Follow-ups
- Manual visual click confirmation in Feishu was not completed during this session. API-level runtime path and Feishu callback unit tests are green, but the actual live card UI update was not visually clicked by a user.
- A prior runtime test produced `persisted mark-notified failed` with Windows `Access is denied` during `decisions.json` atomic rename, likely caused by concurrent file reading while the service wrote. Final serial API verification did not add a new same warning, but future work should avoid reading `decisions.json` while testing notification persistence.
- There is an unrelated untracked file left outside this change: `docs/session-summaries/2026-06-17-feishu-richtext-encoding-closeout.md`.
- PowerShell note: for Go JSON APIs with Chinese text, `Set-Content -Encoding UTF8` in Windows PowerShell can write BOM and break JSON parsing; use `[System.Text.UTF8Encoding]::new($false)` plus `[System.IO.File]::WriteAllText(...)`.

### Dropped Noise
- Repeated shell quoting failures and intermediate malformed JSON attempts were not preserved beyond the durable PowerShell/UTF-8 lesson.
- Long service logs and raw curl responses were summarized to evidence points only.
