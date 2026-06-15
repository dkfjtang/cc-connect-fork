package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func TestParseDecisionAskArgsDefaults(t *testing.T) {
	req, opts, err := parseDecisionAskArgs([]string{
		"--title", "Need confirmation",
		"--message", "Proceed?",
		"--choices", "continue,abort,revise",
		"--wait",
	})
	if err != nil {
		t.Fatalf("parse error = %v", err)
	}
	if req.Title != "Need confirmation" || req.Message != "Proceed?" {
		t.Fatalf("req = %#v", req)
	}
	if len(req.Choices) != 3 || req.Choices[0] != "continue" || req.Choices[2] != "revise" {
		t.Fatalf("choices = %#v", req.Choices)
	}
	if !opts.Wait {
		t.Fatal("Wait = false")
	}
	if req.TimeoutMins != 30 {
		t.Fatalf("TimeoutMins = %d, want 30", req.TimeoutMins)
	}
}

func TestFormatDecisionCLIResponse(t *testing.T) {
	got := formatDecisionCLIResponse("continue", "Use proxy\nif slow.")
	want := "choice=continue\ncomment=\"Use proxy\\nif slow.\"\n"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestWaitForDecisionReturnsResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"decision":{"id":"dec_1","expires_at":"2099-01-01T00:00:00Z"},"response":{"choice":"continue","comment":"ok"}}`))
	}))
	defer srv.Close()

	client := srv.Client()
	client.Transport = rewriteDecisionTransport{base: srv.URL}
	resp, err := waitForDecision(context.Background(), client, "dec_1", time.Millisecond)
	if err != nil {
		t.Fatalf("waitForDecision error = %v", err)
	}
	if resp.Choice != "continue" || resp.Comment != "ok" {
		t.Fatalf("response = %#v", resp)
	}
}

func TestWaitForDecisionReturnsHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusGone)
	}))
	defer srv.Close()

	client := srv.Client()
	client.Transport = rewriteDecisionTransport{base: srv.URL}
	_, err := waitForDecision(context.Background(), client, "dec_1", time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "gone") {
		t.Fatalf("waitForDecision error = %v, want gone", err)
	}
}

func TestWaitForDecisionDetectsExpiredSnapshot(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"decision":{"id":"dec_1","expires_at":"2000-01-01T00:00:00Z"},"response":{"choice":"continue"}}`))
	}))
	defer srv.Close()

	client := srv.Client()
	client.Transport = rewriteDecisionTransport{base: srv.URL}
	_, err := waitForDecision(context.Background(), client, "dec_1", time.Millisecond)
	if !errors.Is(err, core.ErrDecisionTimeout) {
		t.Fatalf("waitForDecision error = %v, want ErrDecisionTimeout", err)
	}
}

type rewriteDecisionTransport struct {
	base string
}

func (t rewriteDecisionTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	rewritten, err := http.NewRequestWithContext(req.Context(), req.Method, t.base+req.URL.RequestURI(), nil)
	if err != nil {
		return nil, err
	}
	return http.DefaultTransport.RoundTrip(rewritten)
}
