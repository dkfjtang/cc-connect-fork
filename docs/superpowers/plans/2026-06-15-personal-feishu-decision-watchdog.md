# Personal Feishu Decision Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a local Codex session run `cc-connect decision ask --wait`, receive a personal Feishu decision prompt, and continue from structured CLI output.

**Architecture:** Add a small decision subsystem behind the existing local Unix-socket API. The CLI creates a pending decision, the daemon sends a personal Feishu card, Feishu button/text input resolves the decision, and the waiting CLI prints `choice=` plus `comment=` lines.

**Tech Stack:** Go, existing cc-connect Unix-socket API, Feishu/Lark SDK adapter, TOML config, existing `core.Card` renderer with a minimal extension only if needed.

---

## Scope

Implement explicit decision prompts only. Defer long-task status notifications, goal auto-detection, bind/discovery flows, group routing, multi-user routing, and project-specific routing.

Defaults: personal-only Feishu recipient, 30-minute wait, first response wins, button choice plus optional text comment.

## File Map

- Create `core/decision.go`: decision types, in-memory store, wait, timeout, idempotent resolve.
- Create `core/decision_test.go`: lifecycle, timeout, duplicate response, invalid choice, comment tests.
- Modify `core/api.go`: add `/decision/ask`, `/decision/respond`, `/decision/get` endpoints and a `DecisionStore` on `APIServer`.
- Modify `core/api_test.go`: local API lifecycle tests with a stub notifier.
- Modify `core/interfaces.go`: add narrow optional `DecisionNotifier` and, if needed, `DecisionResponder` interfaces.
- Create `cmd/cc-connect/decision.go`: `cc-connect decision ask` parser, socket client, wait polling, output formatter.
- Create `cmd/cc-connect/decision_test.go`: parser/default timeout/output tests.
- Modify `cmd/cc-connect/main.go`: register `decision` subcommand and wire API server to platform notifier/responder.
- Modify `config/config.go`, `config/config_test.go`, `config.example.toml`: add `[notify.feishu] default_user_id` and `[watchdog]` fields.
- Modify `platform/feishu/feishu.go`: send personal decision card and resolve card action into the API decision store.
- Modify `platform/feishu/card.go` only if existing card renderer cannot support text input/comment.
- Modify `platform/feishu/card_test.go` / `platform/feishu/platform_test.go`: verify card payload and action routing.

---

### Task 1: Decision Store

**Files:**
- Create: `core/decision.go`
- Create: `core/decision_test.go`

- [ ] **Step 1: Write failing tests**

Create tests for:

```go
func TestDecisionStoreResolveWakesWaiter(t *testing.T)
func TestDecisionStoreRejectsSecondResolve(t *testing.T)
func TestDecisionStoreWaitTimeout(t *testing.T)
func TestDecisionStoreValidatesChoice(t *testing.T)
func TestDecisionStorePreservesComment(t *testing.T)
```

Use `NewDecisionStore()`, `Create(DecisionAskRequest{Title, Message, Choices, Timeout})`, `Wait(ctx, id)`, and `Resolve(id, DecisionResponse{Choice, Comment})`.

- [ ] **Step 2: Verify failure**

Run:

```powershell
rtk go test ./core -run TestDecisionStore -v
```

Expected: compile failure because the store does not exist.

- [x] **Step 3: Implement minimal store**

Define:

```go
var (
    ErrDecisionNotFound      = errors.New("decision not found")
    ErrDecisionResolved      = errors.New("decision already resolved")
    ErrDecisionTimeout       = errors.New("decision timed out")
    ErrDecisionInvalidChoice = errors.New("invalid decision choice")
)

type DecisionAskRequest struct {
    Title string `json:"title"`
    Message string `json:"message"`
    Choices []string `json:"choices"`
    Recommended string `json:"recommended,omitempty"`
    Timeout time.Duration `json:"-"`
    TimeoutMins int `json:"timeout_mins,omitempty"`
}

type Decision struct {
    ID string `json:"id"`
    Title string `json:"title"`
    Message string `json:"message"`
    Choices []string `json:"choices"`
    Recommended string `json:"recommended,omitempty"`
    CreatedAt time.Time `json:"created_at"`
    ExpiresAt time.Time `json:"expires_at"`
}

type DecisionResponse struct {
    DecisionID string `json:"decision_id,omitempty"`
    Choice string `json:"choice"`
    Comment string `json:"comment,omitempty"`
}
```

`DecisionStore` should hold entries in a mutex-protected map, normalize choices, default timeout to 30 minutes, wake waiters by closing a per-decision channel, and reject duplicate/invalid responses.

- [ ] **Step 4: Run tests**

```powershell
rtk go test ./core -run TestDecisionStore -v
```

Expected: PASS.

---

### Task 2: Local Decision API

**Files:**
- Modify: `core/interfaces.go`
- Modify: `core/api.go`
- Modify: `core/api_test.go`

- [ ] **Step 1: Write failing API test**

Add a `stubDecisionNotifier` with `SendDecisionRequest(context.Context, Decision) error`. Test that `POST /decision/ask` creates a decision and calls the notifier, `POST /decision/respond` resolves it, and `GET /decision/get?id=<id>` returns the response.

- [ ] **Step 2: Verify failure**

```powershell
rtk go test ./core -run TestDecisionAPI -v
```

Expected: compile failure for missing API pieces.

- [ ] **Step 3: Add interfaces**

In `core/interfaces.go`:

```go
type DecisionNotifier interface {
    SendDecisionRequest(ctx context.Context, dec Decision) error
}

type DecisionResponder interface {
    SetDecisionResponder(func(context.Context, DecisionResponse) error)
}
```

- [x] **Step 4: Add API server fields and handlers**

Add `decisions *DecisionStore` and `decisionNotifier DecisionNotifier` to `APIServer`. Initialize the store in `NewAPIServer`. Register:

```go
s.mux.HandleFunc("/decision/ask", s.handleDecisionAsk)
s.mux.HandleFunc("/decision/respond", s.handleDecisionRespond)
s.mux.HandleFunc("/decision/get", s.handleDecisionGet)
```

Handlers must use JSON only, return 400 for invalid request/choice, 404 for unknown ID, 409 for duplicate response, and 424/502 if notification is not configured or fails.

- [x] **Step 5: Add resolve callback**

Add:

```go
func (s *APIServer) ResolveDecision(ctx context.Context, resp DecisionResponse) error
func (s *APIServer) SetDecisionNotifier(n DecisionNotifier)
```

- [ ] **Step 6: Run tests**

```powershell
rtk go test ./core -run 'TestDecision(API|Store)' -v
```

Expected: PASS.

---

### Task 3: CLI Command

**Files:**
- Create: `cmd/cc-connect/decision.go`
- Create: `cmd/cc-connect/decision_test.go`
- Modify: `cmd/cc-connect/main.go`

- [ ] **Step 1: Write failing parser/output tests**

Test:

```go
parseDecisionAskArgs([]string{"--title","Need confirmation","--message","Proceed?","--choices","continue,abort,revise","--wait"})
```

Expected request: title/message set, three choices, `TimeoutMins == 30`, wait true.

Test formatter:

```go
formatDecisionCLIResponse("continue", "Use proxy if slow.")
```

Expected:

```text
choice=continue
comment=Use proxy if slow.
```

- [ ] **Step 2: Verify failure**

```powershell
rtk go test ./cmd/cc-connect -run 'TestParseDecision|TestFormatDecision' -v
```

- [x] **Step 3: Implement command**

`cc-connect decision ask` must support:

```text
--title <text>
--message|-m <text>
--choices continue,abort,revise
--recommended <choice>
--timeout-mins <n>  # default 30
--wait
--data-dir <dir>
```

It should post to `/decision/ask`. If `--wait` is set, poll `/decision/get?id=<id>` until response, timeout, or daemon failure, then print `choice=` and `comment=` lines.

- [x] **Step 4: Register subcommand**

In `main.go` subcommand switch:

```go
case "decision":
    runDecision(os.Args[2:])
    return
```

- [ ] **Step 5: Run tests**

```powershell
rtk go test ./cmd/cc-connect -run 'TestParseDecision|TestFormatDecision' -v
```

Expected: PASS.

---

### Task 4: Config

**Files:**
- Modify: `config/config.go`
- Modify: `config/config_test.go`
- Modify: `config.example.toml`

- [ ] **Step 1: Write failing config test**

Parse:

```toml
[notify.feishu]
default_user_id = "ou_owner"

[watchdog]
enabled = true
long_task_notify_mins = 10
decision_reminder_mins = 20
```

Assert fields are populated.

- [x] **Step 2: Add structs**

In `Config`:

```go
Notify NotifyConfig `toml:"notify"`
Watchdog WatchdogConfig `toml:"watchdog"`
```

Add:

```go
type NotifyConfig struct { Feishu FeishuNotifyConfig `toml:"feishu"` }
type FeishuNotifyConfig struct { DefaultUserID string `toml:"default_user_id,omitempty"` }
type WatchdogConfig struct {
    Enabled *bool `toml:"enabled,omitempty"`
    LongTaskNotifyMins int `toml:"long_task_notify_mins,omitempty"`
    DecisionReminderMins int `toml:"decision_reminder_mins,omitempty"`
}
```

- [x] **Step 3: Update example config**

Document that `default_user_id` should be the Feishu user ID already shown by `/whoami` or `/status` and accepted by existing Feishu interaction.

- [ ] **Step 4: Run test**

```powershell
rtk go test ./config -run TestNotifyAndWatchdogConfig -v
```

Expected: PASS.

---

### Task 5: Feishu Personal Notification

**Files:**
- Modify: `platform/feishu/feishu.go`
- Modify: `platform/feishu/card.go` if text input requires a renderer extension
- Modify: `platform/feishu/card_test.go`
- Modify: `platform/feishu/platform_test.go`

- [x] **Step 1: Write failing card test**

Add a test for `buildDecisionCard(core.Decision{ID:"dec_123", Choices: []string{"continue","abort"}})` and assert rendered JSON contains `decision:respond`, `decision_id`, `decision_choice`, `continue`, and `abort`.

- [x] **Step 2: Implement decision card builder**

Use `core.NewCard()` with title, markdown body, and one button per choice. Button `Value` should be `decision:respond`; `Extra` must include `decision_id` and `decision_choice`. Recommended choice should be primary.

- [x] **Step 3: Add notifier config fields**

Add `notifyUserID string` and `decisionResponder func(context.Context, core.DecisionResponse) error` to `Platform`. Parse `notify_user_id` / `default_user_id` from platform options. If absent, allow fallback to exactly one non-wildcard `allow_from` value.

- [x] **Step 4: Implement `SendDecisionRequest`**

Send an interactive card to the configured personal user. Inspect existing `createMessage` and Feishu receive-id handling. If `createMessage` assumes chat IDs, add a dedicated `createUserMessage(ctx, userID, msgType, content, op string)` helper using the same retry/token path.

- [x] **Step 5: Implement card action response**

In existing card action handler, branch on `action == "decision:respond"`, extract `decision_id`, `decision_choice`, and optional text comment, then call `decisionResponder`.

If Feishu card text input support is too invasive, still store `Comment` in the response model and implement button choice first, but do not mark the MVP complete until comment capture is implemented.

Implemented with a Feishu form input named `decision_comment`; button submit actions resolve both `choice` and `comment`.

- [x] **Step 6: Run Feishu tests**

```powershell
rtk go test ./platform/feishu -run 'TestBuildDecisionCard|Test.*Decision' -v
```

Expected: PASS.

Verified on Windows with local Go 1.25.0 and repository-local Go caches:

```powershell
go test ./platform/feishu -run TestBuildDecisionCard -v
```

Result: PASS.

---

### Task 6: Startup Wiring

**Files:**
- Modify: `cmd/cc-connect/main.go`
- Modify: `platform/feishu/feishu.go` if config option propagation is needed

- [x] **Step 1: Propagate notify config**

When building Feishu platform options, set `notify_user_id` from `[notify.feishu].default_user_id` if present. Do not override explicit platform option values.

- [x] **Step 2: Wire notifier/responder**

Where `APIServer` and platforms are both available, set the first `core.DecisionNotifier` as API notifier and call `SetDecisionResponder(apiServer.ResolveDecision)` on platforms implementing `core.DecisionResponder`.

- [x] **Step 3: Run integration compile tests**

```powershell
rtk go test ./core ./cmd/cc-connect ./platform/feishu ./config -run 'TestDecision|TestBuildDecisionCard|TestParseDecision|TestNotifyAndWatchdogConfig' -v
```

Expected: PASS.

Verified with the local web asset build tag disabled because `web/dist` is not checked in:

```powershell
go test -tags no_web ./core ./config ./platform/feishu ./cmd/cc-connect
```

Result: PASS.

---

### Task 7: Verification And Docs

**Files:**
- Modify: `docs/plans/2026-06-15-personal-feishu-decision-watchdog-design.md`
- Modify: `docs/feishu.md` or `docs/usage.md` if implementation exposes stable user-facing syntax

- [x] **Step 1: Run targeted tests**

```powershell
rtk go test ./core ./cmd/cc-connect ./platform/feishu ./config -v
```

- [x] **Step 2: Run broader tests**

```powershell
rtk go test ./...
```

If Windows resource limits block full tests, report the failing command and run the affected package groups.

Executed:

```powershell
go test -tags no_web ./...
```

Result: FAIL on existing Windows/environment-dependent packages unrelated to the decision path, including missing external CLIs (`true`, `claude`, `sh`, `echo`), Windows home/path assumptions, daemon metadata write permissions, and an engine-matrix temp cleanup race. The affected decision packages were re-run separately and passed.

- [ ] **Step 3: Manual smoke**

With daemon and Feishu configured:

```powershell
cc-connect decision ask --title "Smoke decision" --message "Click continue and add a short note." --choices "continue,abort" --recommended continue --timeout-mins 30 --wait
```

Expected output after Feishu response:

```text
choice=continue
comment=<note or empty>
```

- [ ] **Step 4: Update design status**

Change the design doc from `Draft` to `Implemented` only after button and text comment both work. Use `Partially Implemented` if button choice works but comment capture remains pending.

---

## Self-Review

- Covers personal-only target, decision ask/wait, 30-minute default, idempotent response, buttons plus comment, and Feishu proactive private notification.
- Defers long-task status updates and goal auto-detection as requested.
- Keeps core platform-agnostic through optional interfaces.
- Main risk is Feishu personal receive ID handling; Task 5 requires using the existing retry/token path and adding a dedicated helper if current chat send cannot target a user.
