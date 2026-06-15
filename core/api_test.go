package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type stubDecisionNotifier struct {
	sent []Decision
	err  error
}

func (s *stubDecisionNotifier) SendDecisionRequest(_ context.Context, dec Decision) error {
	s.sent = append(s.sent, dec)
	return s.err
}

func TestHandleSend_AllowsAttachmentOnly(t *testing.T) {
	engine := NewEngine("test", &stubAgent{}, []Platform{&stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}, "", LangEnglish)
	engine.interactiveStates["session-1"] = &interactiveState{
		platform: &stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}},
		replyCtx: "reply-ctx",
	}

	api := &APIServer{engines: map[string]*Engine{"test": engine}}
	reqBody := SendRequest{
		Project:    "test",
		SessionKey: "session-1",
		Images: []ImageAttachment{{
			MimeType: "image/png",
			Data:     []byte("img"),
			FileName: "chart.png",
		}},
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleSend(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestDecisionAPIAskRespondAndGet(t *testing.T) {
	notifier := &stubDecisionNotifier{}
	api := &APIServer{decisions: NewDecisionStore()}
	api.SetDecisionNotifier(notifier)

	body := strings.NewReader(`{"title":"Need confirmation","message":"Proceed?","choices":["continue","abort"],"timeout_mins":1}`)
	rec := httptest.NewRecorder()
	api.handleDecisionAsk(rec, httptest.NewRequest(http.MethodPost, "/decision/ask", body))
	if rec.Code != http.StatusOK {
		t.Fatalf("ask status = %d body=%s", rec.Code, rec.Body.String())
	}
	var dec Decision
	if err := json.Unmarshal(rec.Body.Bytes(), &dec); err != nil {
		t.Fatalf("decode ask: %v", err)
	}
	if dec.ID == "" || len(notifier.sent) != 1 {
		t.Fatalf("decision ID = %q sent=%d", dec.ID, len(notifier.sent))
	}

	respBody := strings.NewReader(`{"decision_id":"` + dec.ID + `","choice":"continue","comment":"ok"}`)
	rec = httptest.NewRecorder()
	api.handleDecisionRespond(rec, httptest.NewRequest(http.MethodPost, "/decision/respond", respBody))
	if rec.Code != http.StatusOK {
		t.Fatalf("respond status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	api.handleDecisionGet(rec, httptest.NewRequest(http.MethodGet, "/decision/get?id="+dec.ID, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"choice":"continue"`) || !strings.Contains(rec.Body.String(), `"comment":"ok"`) {
		t.Fatalf("get body missing response: %s", rec.Body.String())
	}
}

func TestDecisionAPIAskRollsBackWithoutNotifier(t *testing.T) {
	api := &APIServer{decisions: NewDecisionStore()}
	body := strings.NewReader(`{"title":"Need confirmation","message":"Proceed?","choices":["continue"],"timeout_mins":1}`)
	rec := httptest.NewRecorder()
	api.handleDecisionAsk(rec, httptest.NewRequest(http.MethodPost, "/decision/ask", body))
	if rec.Code != http.StatusFailedDependency {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if got := len(api.decisionStore().entries); got != 0 {
		t.Fatalf("decision entries = %d, want rollback to empty", got)
	}
}

func TestDecisionAPIAskRollsBackWhenNotifierFails(t *testing.T) {
	api := &APIServer{decisions: NewDecisionStore()}
	api.SetDecisionNotifier(&stubDecisionNotifier{err: errors.New("send failed")})
	body := strings.NewReader(`{"title":"Need confirmation","message":"Proceed?","choices":["continue"],"timeout_mins":1}`)
	rec := httptest.NewRecorder()
	api.handleDecisionAsk(rec, httptest.NewRequest(http.MethodPost, "/decision/ask", body))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if got := len(api.decisionStore().entries); got != 0 {
		t.Fatalf("decision entries = %d, want rollback to empty", got)
	}
}

func TestDecisionAPIAskDedupesSameEventFingerprintDuringCooldown(t *testing.T) {
	notifier := &stubDecisionNotifier{}
	ledger := NewNotificationLedger("")
	api := &APIServer{decisions: NewDecisionStore(), notificationLedger: ledger}
	api.SetDecisionNotifier(notifier)

	body := strings.NewReader(`{"title":"Need confirmation","message":"Proceed?","choices":["continue"],"timeout_mins":1,"event_key":"thread-1:blocked","event_fingerprint":"last-message-1","cooldown_mins":30}`)
	rec := httptest.NewRecorder()
	api.handleDecisionAsk(rec, httptest.NewRequest(http.MethodPost, "/decision/ask", body))
	if rec.Code != http.StatusOK {
		t.Fatalf("first ask status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(notifier.sent) != 1 {
		t.Fatalf("sent decisions = %d, want 1", len(notifier.sent))
	}

	body = strings.NewReader(`{"title":"Need confirmation","message":"Proceed?","choices":["continue"],"timeout_mins":1,"event_key":"thread-1:blocked","event_fingerprint":"last-message-1","cooldown_mins":30}`)
	rec = httptest.NewRecorder()
	api.handleDecisionAsk(rec, httptest.NewRequest(http.MethodPost, "/decision/ask", body))
	if rec.Code != http.StatusAlreadyReported {
		t.Fatalf("duplicate ask status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(notifier.sent) != 1 {
		t.Fatalf("sent decisions = %d, want still 1", len(notifier.sent))
	}
	if !strings.Contains(rec.Body.String(), `"deduped":true`) {
		t.Fatalf("duplicate body missing deduped flag: %s", rec.Body.String())
	}
}

func TestDecisionAPIAskNotifiesWhenFingerprintChanges(t *testing.T) {
	notifier := &stubDecisionNotifier{}
	ledger := NewNotificationLedger("")
	api := &APIServer{decisions: NewDecisionStore(), notificationLedger: ledger}
	api.SetDecisionNotifier(notifier)

	for _, fingerprint := range []string{"last-message-1", "last-message-2"} {
		body := strings.NewReader(`{"title":"Need confirmation","message":"Proceed?","choices":["continue"],"timeout_mins":1,"event_key":"thread-1:blocked","event_fingerprint":"` + fingerprint + `","cooldown_mins":30}`)
		rec := httptest.NewRecorder()
		api.handleDecisionAsk(rec, httptest.NewRequest(http.MethodPost, "/decision/ask", body))
		if rec.Code != http.StatusOK {
			t.Fatalf("ask status = %d body=%s", rec.Code, rec.Body.String())
		}
	}
	if len(notifier.sent) != 2 {
		t.Fatalf("sent decisions = %d, want 2", len(notifier.sent))
	}
}

func TestDecisionAPIRespondErrors(t *testing.T) {
	api := &APIServer{decisions: NewDecisionStore()}
	dec, err := api.decisionStore().Create(DecisionAskRequest{Title: "T", Message: "M", Choices: []string{"yes"}, Timeout: time.Minute})
	if err != nil {
		t.Fatalf("Create error = %v", err)
	}
	cases := []struct {
		name string
		body string
		want int
	}{
		{name: "empty decision id", body: `{"choice":"yes"}`, want: http.StatusBadRequest},
		{name: "not found", body: `{"decision_id":"dec_missing","choice":"yes"}`, want: http.StatusNotFound},
		{name: "invalid choice", body: `{"decision_id":"` + dec.ID + `","choice":"no"}`, want: http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			api.handleDecisionRespond(rec, httptest.NewRequest(http.MethodPost, "/decision/respond", strings.NewReader(tc.body)))
			if rec.Code != tc.want {
				t.Fatalf("status = %d body=%s want=%d", rec.Code, rec.Body.String(), tc.want)
			}
		})
	}
	rec := httptest.NewRecorder()
	api.handleDecisionRespond(rec, httptest.NewRequest(http.MethodPost, "/decision/respond", strings.NewReader(`{"decision_id":"`+dec.ID+`","choice":"yes"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("first respond status = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	api.handleDecisionRespond(rec, httptest.NewRequest(http.MethodPost, "/decision/respond", strings.NewReader(`{"decision_id":"`+dec.ID+`","choice":"yes"}`)))
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestDecisionAPIGetExpiredReturnsGoneAndDeletes(t *testing.T) {
	store := NewDecisionStore()
	now := time.Now()
	store.now = func() time.Time { return now }
	api := &APIServer{decisions: store}
	dec, err := store.Create(DecisionAskRequest{Title: "T", Message: "M", Choices: []string{"yes"}, Timeout: time.Minute})
	if err != nil {
		t.Fatalf("Create error = %v", err)
	}
	now = dec.ExpiresAt
	rec := httptest.NewRecorder()
	api.handleDecisionGet(rec, httptest.NewRequest(http.MethodGet, "/decision/get?id="+dec.ID, nil))
	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if _, ok := store.Get(dec.ID); ok {
		t.Fatal("expired decision still exists")
	}
}

// TestHandleSend_UnknownProjectReturns404 ensures the API does NOT silently
// fall back to the only registered engine when the caller named a different
// project. Previously a typo'd project name routed messages to whatever
// single engine happened to be loaded.
func TestHandleSend_UnknownProjectReturns404(t *testing.T) {
	engine := NewEngine("projectA", &stubAgent{}, []Platform{&stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}, "", LangEnglish)
	engine.interactiveStates["session-1"] = &interactiveState{
		platform: &stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}},
		replyCtx: "reply-ctx",
	}

	api := &APIServer{engines: map[string]*Engine{"projectA": engine}}
	body, err := json.Marshal(SendRequest{
		Project:    "projectB", // typo; does NOT match the loaded engine
		SessionKey: "session-1",
		Message:    "hi",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleSend(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"projectB"`) {
		t.Errorf("body should mention the unknown project name, got: %s", rec.Body.String())
	}
}

// TestHandleSend_EmptyProjectFallsBackToSingleEngine documents the intended
// convenience behavior: when the caller omits project entirely AND only one
// engine is loaded, the API picks it automatically.
func TestHandleSend_EmptyProjectFallsBackToSingleEngine(t *testing.T) {
	engine := NewEngine("solo", &stubAgent{}, []Platform{&stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}, "", LangEnglish)
	engine.interactiveStates["session-1"] = &interactiveState{
		platform: &stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}},
		replyCtx: "reply-ctx",
	}

	api := &APIServer{engines: map[string]*Engine{"solo": engine}}
	body, err := json.Marshal(SendRequest{
		// Project deliberately omitted.
		SessionKey: "session-1",
		Message:    "hi",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleSend(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
}

// TestHandleSend_EmptyProjectMultipleEnginesRequiresName ensures the API
// refuses to guess when more than one engine is loaded and the caller did
// not specify which one to send to.
func TestHandleSend_EmptyProjectMultipleEnginesRequiresName(t *testing.T) {
	engineA := NewEngine("a", &stubAgent{}, []Platform{&stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}, "", LangEnglish)
	engineB := NewEngine("b", &stubAgent{}, []Platform{&stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}, "", LangEnglish)
	api := &APIServer{engines: map[string]*Engine{"a": engineA, "b": engineB}}

	body, err := json.Marshal(SendRequest{
		SessionKey: "session-1",
		Message:    "hi",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleSend(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandleCronExec_TriggersJob(t *testing.T) {
	store, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	scheduler := NewCronScheduler(store)

	platform := &stubCronReplyTargetPlatform{
		stubPlatformEngine: stubPlatformEngine{n: "discord"},
	}
	agentSession := newResultAgentSession("triggered from local api")
	engine := NewEngine("test", &resultAgent{session: agentSession}, []Platform{platform}, "", LangEnglish)
	defer engine.cancel()
	engine.cronScheduler = scheduler
	scheduler.RegisterEngine("test", engine)

	job := &CronJob{
		ID:          "job-run-api",
		Project:     "test",
		SessionKey:  "discord:channel-1:user-1",
		CronExpr:    "0 6 * * *",
		Prompt:      "run now",
		Description: "Run from API",
		Enabled:     false,
	}
	if err := store.Add(job); err != nil {
		t.Fatal(err)
	}

	api := &APIServer{engines: map[string]*Engine{"test": engine}, cron: scheduler}
	body, err := json.Marshal(map[string]any{"id": job.ID})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/cron/exec", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleCronExec(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(platform.getSent()) >= 2 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for local api trigger, sent=%v", platform.getSent())
}

func TestHandleCronExec_RunAliasRouteTriggersJob(t *testing.T) {
	store, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	scheduler := NewCronScheduler(store)

	platform := &stubCronReplyTargetPlatform{
		stubPlatformEngine: stubPlatformEngine{n: "discord"},
	}
	agentSession := newResultAgentSession("triggered from local api alias")
	engine := NewEngine("test", &resultAgent{session: agentSession}, []Platform{platform}, "", LangEnglish)
	defer engine.cancel()
	engine.cronScheduler = scheduler
	scheduler.RegisterEngine("test", engine)

	job := &CronJob{
		ID:          "job-run-api-alias",
		Project:     "test",
		SessionKey:  "discord:channel-1:user-1",
		CronExpr:    "0 6 * * *",
		Prompt:      "run alias now",
		Description: "Run from API alias",
		Enabled:     false,
	}
	if err := store.Add(job); err != nil {
		t.Fatal(err)
	}

	api := &APIServer{engines: map[string]*Engine{"test": engine}, cron: scheduler, mux: http.NewServeMux()}
	api.mux.HandleFunc("/cron/exec", api.handleCronExec)
	api.mux.HandleFunc("/cron/run", api.handleCronExec)
	body, err := json.Marshal(map[string]any{"id": job.ID})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/cron/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(platform.getSent()) >= 2 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for local api alias trigger, sent=%v", platform.getSent())
}

func TestHandleCronExec_ProjectMissingIsBadRequest(t *testing.T) {
	store, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	scheduler := NewCronScheduler(store)

	job := &CronJob{
		ID:         "job-run-missing-project",
		Project:    "ghost",
		SessionKey: "discord:channel-1:user-1",
		CronExpr:   "0 6 * * *",
		Prompt:     "run now",
		Enabled:    true,
	}
	if err := store.Add(job); err != nil {
		t.Fatal(err)
	}

	api := &APIServer{cron: scheduler}
	body, err := json.Marshal(map[string]any{"id": job.ID})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/cron/exec", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleCronExec(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
}
