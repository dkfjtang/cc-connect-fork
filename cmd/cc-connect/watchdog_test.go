package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func TestParseWatchdogCheckpointArgsDefaults(t *testing.T) {
	req, opts, err := parseWatchdogCheckpointArgs([]string{
		"--task", "release gate",
		"--summary", "tests are still running",
		"--elapsed-mins", "12",
	})
	if err != nil {
		t.Fatalf("parseWatchdogCheckpointArgs error = %v", err)
	}
	if opts.ThresholdMins != 10 {
		t.Fatalf("ThresholdMins = %d", opts.ThresholdMins)
	}
	if opts.ElapsedMins != 12 {
		t.Fatalf("ElapsedMins = %d", opts.ElapsedMins)
	}
	if opts.Wait {
		t.Fatalf("Wait = true, want false")
	}
	if req.Title != "长任务需要确认: release gate" {
		t.Fatalf("Title = %q", req.Title)
	}
	if req.TimeoutMins != 30 {
		t.Fatalf("TimeoutMins = %d", req.TimeoutMins)
	}
	if strings.Join(req.Choices, ",") != "continue,pause,revise" {
		t.Fatalf("Choices = %#v", req.Choices)
	}
	if req.Recommended != "continue" {
		t.Fatalf("Recommended = %q", req.Recommended)
	}
}

func TestParseWatchdogCheckpointArgsNotificationDedup(t *testing.T) {
	req, _, err := parseWatchdogCheckpointArgs([]string{
		"--task", "release gate",
		"--summary", "tests are still running",
		"--elapsed-mins", "30",
		"--event-key", "thread-1:checkpoint",
		"--event-fingerprint", "turn-123",
		"--cooldown-mins", "30",
	})
	if err != nil {
		t.Fatalf("parseWatchdogCheckpointArgs error = %v", err)
	}
	if req.EventKey != "thread-1:checkpoint" {
		t.Fatalf("EventKey = %q", req.EventKey)
	}
	if req.EventFingerprint != "turn-123" {
		t.Fatalf("EventFingerprint = %q", req.EventFingerprint)
	}
	if req.CooldownMins != 30 {
		t.Fatalf("CooldownMins = %d", req.CooldownMins)
	}
}

func TestParseWatchdogCheckpointSkipsBelowThreshold(t *testing.T) {
	_, opts, err := parseWatchdogCheckpointArgs([]string{
		"--task", "index rebuild",
		"--summary", "still below threshold",
		"--elapsed-mins", "9",
		"--threshold-mins", "10",
	})
	if err != nil {
		t.Fatalf("parseWatchdogCheckpointArgs error = %v", err)
	}
	if !opts.Skip {
		t.Fatalf("Skip = false, want true")
	}
}

func TestParseWatchdogCheckpointRequiresFields(t *testing.T) {
	_, _, err := parseWatchdogCheckpointArgs([]string{"--task", "missing summary", "--elapsed-mins", "11"})
	if err == nil || !strings.Contains(err.Error(), "--summary is required") {
		t.Fatalf("error = %v, want summary requirement", err)
	}
}

func TestRunWatchdogCheckpointPostsDecision(t *testing.T) {
	var gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/decision/ask":
			body := make([]byte, r.ContentLength)
			_, _ = r.Body.Read(body)
			gotBody = string(body)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"id":"dec_1","title":"长任务需要确认: release","choices":["continue","pause","revise"],"expires_at":"2099-01-01T00:00:00Z"}`))
		case "/decision/get":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"decision":{"id":"dec_1","expires_at":"2099-01-01T00:00:00Z"},"response":{"choice":"continue","comment":"ok"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := server.Client()
	resp, err := runWatchdogCheckpointWithClient(context.Background(), client, server.URL, core.DecisionAskRequest{
		Title:       "长任务需要确认: release",
		Message:     "任务: release\n已运行: 12 分钟\n当前状态: tests running\n\n请选择下一步。",
		Choices:     []string{"continue", "pause", "revise"},
		Recommended: "continue",
		TimeoutMins: 30,
	}, watchdogCheckpointOptions{Wait: true})
	if err != nil {
		t.Fatalf("runWatchdogCheckpointWithClient error = %v", err)
	}
	if resp.DecisionID != "dec_1" {
		t.Fatalf("DecisionID = %q", resp.DecisionID)
	}
	if resp.Response == nil || resp.Response.Choice != "continue" {
		t.Fatalf("Response = %#v", resp.Response)
	}
	if !strings.Contains(gotBody, `"title":"长任务需要确认: release"`) {
		t.Fatalf("request body = %s", gotBody)
	}
}

func TestRunWatchdogCheckpointNoWait(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/decision/ask" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"dec_2","expires_at":"2099-01-01T00:00:00Z"}`))
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	resp, err := runWatchdogCheckpointWithClient(ctx, server.Client(), server.URL, core.DecisionAskRequest{
		Title:       "长任务需要确认: release",
		Message:     "status",
		Choices:     []string{"continue", "pause", "revise"},
		Recommended: "continue",
		TimeoutMins: 30,
	}, watchdogCheckpointOptions{})
	if err != nil {
		t.Fatalf("runWatchdogCheckpointWithClient error = %v", err)
	}
	if resp.DecisionID != "dec_2" {
		t.Fatalf("DecisionID = %q", resp.DecisionID)
	}
	if resp.Response != nil {
		t.Fatalf("Response = %#v, want nil", resp.Response)
	}
}

func TestRunWatchdogCheckpointDeduped(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/decision/ask" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAlreadyReported)
		w.Write([]byte(`{"deduped":true,"event_key":"thread-1:blocked","event_fingerprint":"turn-1","decision_id":"dec_1"}`))
	}))
	defer server.Close()

	resp, err := runWatchdogCheckpointWithClient(context.Background(), server.Client(), server.URL, core.DecisionAskRequest{
		Title:            "长任务需要确认: release",
		Message:          "status",
		Choices:          []string{"continue", "pause", "revise"},
		EventKey:         "thread-1:blocked",
		EventFingerprint: "turn-1",
		CooldownMins:     30,
		TimeoutMins:      30,
	}, watchdogCheckpointOptions{})
	if err != nil {
		t.Fatalf("runWatchdogCheckpointWithClient error = %v", err)
	}
	if !strings.Contains(resp.Deduped, "notification=deduped") || !strings.Contains(resp.Deduped, "decision_id=dec_1") {
		t.Fatalf("Deduped = %q", resp.Deduped)
	}
}
