package main

import "testing"

func TestParseDecisionAskArgs(t *testing.T) {
	req, opts, err := parseDecisionAskArgs([]string{
		"--title", "Need confirmation",
		"--message", "Proceed?",
		"--choices", "continue,abort,revise",
		"--wait",
	})
	if err != nil {
		t.Fatalf("parseDecisionAskArgs: %v", err)
	}
	if req.Title != "Need confirmation" {
		t.Fatalf("Title = %q", req.Title)
	}
	if req.Message != "Proceed?" {
		t.Fatalf("Message = %q", req.Message)
	}
	if len(req.Choices) != 3 || req.Choices[0] != "continue" || req.Choices[1] != "abort" || req.Choices[2] != "revise" {
		t.Fatalf("Choices = %#v", req.Choices)
	}
	if req.TimeoutMins != 30 {
		t.Fatalf("TimeoutMins = %d, want 30", req.TimeoutMins)
	}
	if !opts.wait {
		t.Fatal("wait = false, want true")
	}
}

func TestParseDecisionAskArgsSetsScopeFromEnvironment(t *testing.T) {
	t.Setenv("CC_PROJECT", "project-a")
	t.Setenv("CC_SESSION_KEY", "feishu:user:session")

	req, _, err := parseDecisionAskArgs([]string{
		"--title", "Need confirmation",
		"--message", "Proceed?",
		"--choices", "continue,abort",
	})
	if err != nil {
		t.Fatalf("parseDecisionAskArgs: %v", err)
	}
	want := "project=project-a;session=feishu:user:session"
	if req.Scope != want {
		t.Fatalf("Scope = %q, want %q", req.Scope, want)
	}
}

func TestFormatDecisionCLIResponse(t *testing.T) {
	got := formatDecisionCLIResponse("continue", "Use proxy if slow.")
	want := "choice=continue\ncomment=Use proxy if slow.\n"
	if got != want {
		t.Fatalf("formatDecisionCLIResponse = %q, want %q", got, want)
	}
}
