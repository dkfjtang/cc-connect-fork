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
	sent    []Decision
	err     error
	block   chan struct{}
	started chan struct{}
}

func (s *stubDecisionNotifier) SendDecisionRequest(_ context.Context, dec Decision) error {
	if s.started != nil {
		close(s.started)
		s.started = nil
	}
	if s.block != nil {
		<-s.block
	}
	if s.err != nil {
		return s.err
	}
	s.sent = append(s.sent, dec)
	return nil
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

func TestDecisionAPIAskRespondGet(t *testing.T) {
	notifier := &stubDecisionNotifier{}
	api := &APIServer{
		decisions: NewDecisionStore(),
		notifier:  notifier,
	}
	body, err := json.Marshal(DecisionAskRequest{
		Title:       "Need confirmation",
		Message:     "Proceed?",
		Choices:     []string{"continue", "abort"},
		Recommended: "continue",
		TimeoutMins: 30,
	})
	if err != nil {
		t.Fatalf("marshal ask: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/decision/ask", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleDecisionAsk(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("ask status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(notifier.sent) != 1 {
		t.Fatalf("notifier sent %d decisions, want 1", len(notifier.sent))
	}
	var dec Decision
	if err := json.Unmarshal(rec.Body.Bytes(), &dec); err != nil {
		t.Fatalf("decode decision: %v", err)
	}
	if dec.ID == "" {
		t.Fatal("decision ID is empty")
	}

	respBody, err := json.Marshal(DecisionResponse{
		DecisionID: dec.ID,
		Choice:     "continue",
		Comment:    "Use proxy if slow.",
	})
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/decision/respond", bytes.NewReader(respBody))
	rec = httptest.NewRecorder()
	api.handleDecisionRespond(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("respond status = %d, body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/decision/get?id="+dec.ID, nil)
	rec = httptest.NewRecorder()
	api.handleDecisionGet(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var record DecisionRecord
	if err := json.Unmarshal(rec.Body.Bytes(), &record); err != nil {
		t.Fatalf("decode record: %v", err)
	}
	if record.Response == nil || record.Response.Choice != "continue" || record.Response.Comment != "Use proxy if slow." {
		t.Fatalf("record response = %#v", record.Response)
	}
}

func TestDecisionAPIReusedPendingDecisionDoesNotNotifyAgain(t *testing.T) {
	notifier := &stubDecisionNotifier{}
	api := &APIServer{
		decisions: NewDecisionStore(),
		notifier:  notifier,
	}
	body, err := json.Marshal(DecisionAskRequest{
		Title:       "Need confirmation",
		Message:     "Proceed?",
		Choices:     []string{"continue", "abort"},
		Recommended: "continue",
		TimeoutMins: 30,
	})
	if err != nil {
		t.Fatalf("marshal ask: %v", err)
	}

	var first Decision
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/decision/ask", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		api.handleDecisionAsk(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("ask %d status = %d, body=%s", i+1, rec.Code, rec.Body.String())
		}
		var dec Decision
		if err := json.Unmarshal(rec.Body.Bytes(), &dec); err != nil {
			t.Fatalf("decode decision %d: %v", i+1, err)
		}
		if i == 0 {
			first = dec
			continue
		}
		if dec.ID != first.ID {
			t.Fatalf("second decision ID = %q, want reused %q", dec.ID, first.ID)
		}
	}
	if len(notifier.sent) != 1 {
		t.Fatalf("notifier sent %d decisions, want 1", len(notifier.sent))
	}
}

func TestDecisionAPINotifierFailureDoesNotReservePendingDecision(t *testing.T) {
	notifier := &stubDecisionNotifier{err: errors.New("send failed")}
	api := &APIServer{
		decisions: NewDecisionStore(),
		notifier:  notifier,
	}
	body, err := json.Marshal(DecisionAskRequest{
		Title:       "Need confirmation",
		Message:     "Proceed?",
		Choices:     []string{"continue", "abort"},
		Recommended: "continue",
		TimeoutMins: 30,
	})
	if err != nil {
		t.Fatalf("marshal ask: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/decision/ask", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleDecisionAsk(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("first ask status = %d, body=%s", rec.Code, rec.Body.String())
	}

	notifier.err = nil
	req = httptest.NewRequest(http.MethodPost, "/decision/ask", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	api.handleDecisionAsk(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("second ask status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(notifier.sent) != 1 {
		t.Fatalf("notifier sent %d decisions after retry, want 1", len(notifier.sent))
	}
}

func TestDecisionAPIConcurrentAskDuringNotificationDoesNotReturnRolledBackDecision(t *testing.T) {
	block := make(chan struct{})
	started := make(chan struct{})
	notifier := &stubDecisionNotifier{err: errors.New("send failed"), block: block, started: started}
	api := &APIServer{
		decisions: NewDecisionStore(),
		notifier:  notifier,
	}
	body, err := json.Marshal(DecisionAskRequest{
		Title:       "Need confirmation",
		Message:     "Proceed?",
		Choices:     []string{"continue", "abort"},
		Recommended: "continue",
		TimeoutMins: 30,
	})
	if err != nil {
		t.Fatalf("marshal ask: %v", err)
	}

	firstDone := make(chan int, 1)
	go func() {
		req := httptest.NewRequest(http.MethodPost, "/decision/ask", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		api.handleDecisionAsk(rec, req)
		firstDone <- rec.Code
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for notifier to start")
	}

	req := httptest.NewRequest(http.MethodPost, "/decision/ask", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleDecisionAsk(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("concurrent ask status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}

	close(block)
	if code := <-firstDone; code != http.StatusBadGateway {
		t.Fatalf("first ask status = %d, want 502", code)
	}
}

func TestDecisionAPIMissingNotifierDoesNotReservePendingDecision(t *testing.T) {
	notifier := &stubDecisionNotifier{}
	api := &APIServer{
		decisions: NewDecisionStore(),
	}
	body, err := json.Marshal(DecisionAskRequest{
		Title:       "Need confirmation",
		Message:     "Proceed?",
		Choices:     []string{"continue", "abort"},
		Recommended: "continue",
		TimeoutMins: 30,
	})
	if err != nil {
		t.Fatalf("marshal ask: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/decision/ask", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	api.handleDecisionAsk(rec, req)
	if rec.Code != http.StatusFailedDependency {
		t.Fatalf("first ask status = %d, body=%s", rec.Code, rec.Body.String())
	}

	api.notifier = notifier
	req = httptest.NewRequest(http.MethodPost, "/decision/ask", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	api.handleDecisionAsk(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("second ask status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(notifier.sent) != 1 {
		t.Fatalf("notifier sent %d decisions after retry, want 1", len(notifier.sent))
	}
}

func TestDecisionAPIRespondTimeoutReturnsGone(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Nanosecond,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
	}
	api := &APIServer{decisions: store}
	time.Sleep(time.Millisecond)

	respBody, err := json.Marshal(DecisionResponse{DecisionID: dec.ID, Choice: "continue"})
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/decision/respond", bytes.NewReader(respBody))
	rec := httptest.NewRecorder()
	api.handleDecisionRespond(rec, req)
	if rec.Code != http.StatusGone {
		t.Fatalf("respond status = %d, want 410; body=%s", rec.Code, rec.Body.String())
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
