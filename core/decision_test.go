package core

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDecisionStoreResolveWakesWaiter(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Install dependency?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("Create error = %v", err)
	}

	done := make(chan DecisionResponse, 1)
	errCh := make(chan error, 1)
	go func() {
		resp, err := store.Wait(context.Background(), dec.ID)
		if err != nil {
			errCh <- err
			return
		}
		done <- resp
	}()

	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "continue", Comment: "Use proxy if slow."}); err != nil {
		t.Fatalf("Resolve error = %v", err)
	}

	select {
	case err := <-errCh:
		t.Fatalf("Wait error = %v", err)
	case resp := <-done:
		if resp.Choice != "continue" || resp.Comment != "Use proxy if slow." {
			t.Fatalf("resp = %#v", resp)
		}
	case <-time.After(time.Second):
		t.Fatal("Wait did not return")
	}
}

func TestDecisionStoreRejectsSecondResolve(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{Title: "T", Message: "M", Choices: []string{"yes"}, Timeout: time.Minute})
	if err != nil {
		t.Fatalf("Create error = %v", err)
	}
	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "yes"}); err != nil {
		t.Fatalf("first Resolve error = %v", err)
	}
	err = store.Resolve(dec.ID, DecisionResponse{Choice: "yes"})
	if !errors.Is(err, ErrDecisionResolved) {
		t.Fatalf("second Resolve error = %v, want ErrDecisionResolved", err)
	}
}

func TestDecisionStoreWaitTimeout(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{Title: "T", Message: "M", Choices: []string{"yes"}, Timeout: 20 * time.Millisecond})
	if err != nil {
		t.Fatalf("Create error = %v", err)
	}
	_, err = store.Wait(context.Background(), dec.ID)
	if !errors.Is(err, ErrDecisionTimeout) {
		t.Fatalf("Wait error = %v, want ErrDecisionTimeout", err)
	}
}

func TestDecisionStoreRejectsExpiredResolve(t *testing.T) {
	store := NewDecisionStore()
	now := time.Now()
	store.now = func() time.Time { return now }
	dec, err := store.Create(DecisionAskRequest{Title: "T", Message: "M", Choices: []string{"yes"}, Timeout: time.Minute})
	if err != nil {
		t.Fatalf("Create error = %v", err)
	}
	now = dec.ExpiresAt.Add(time.Second)
	err = store.Resolve(dec.ID, DecisionResponse{Choice: "yes"})
	if !errors.Is(err, ErrDecisionTimeout) {
		t.Fatalf("Resolve error = %v, want ErrDecisionTimeout", err)
	}
	_, resp, ok := store.Snapshot(dec.ID)
	if !ok {
		t.Fatal("Snapshot ok=false")
	}
	if resp != nil {
		t.Fatalf("Snapshot response = %#v, want nil", resp)
	}
}

func TestDecisionStoreValidatesChoice(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{Title: "T", Message: "M", Choices: []string{"continue", "abort"}, Timeout: time.Minute})
	if err != nil {
		t.Fatalf("Create error = %v", err)
	}
	err = store.Resolve(dec.ID, DecisionResponse{Choice: "revise"})
	if !errors.Is(err, ErrDecisionInvalidChoice) {
		t.Fatalf("Resolve error = %v, want ErrDecisionInvalidChoice", err)
	}
}

func TestDecisionStoreValidatesRecommendedChoice(t *testing.T) {
	store := NewDecisionStore()
	_, err := store.Create(DecisionAskRequest{
		Title:       "T",
		Message:     "M",
		Choices:     []string{"continue", "abort"},
		Recommended: "revise",
		Timeout:     time.Minute,
	})
	if err == nil {
		t.Fatal("Create error = nil, want invalid recommended choice")
	}
}

func TestDecisionStorePreservesComment(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{Title: "T", Message: "M", Choices: []string{"continue"}, Timeout: time.Minute})
	if err != nil {
		t.Fatalf("Create error = %v", err)
	}
	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "continue", Comment: "先不要改生产配置"}); err != nil {
		t.Fatalf("Resolve error = %v", err)
	}
	_, resp, ok := store.Snapshot(dec.ID)
	if !ok || resp == nil {
		t.Fatalf("Snapshot ok=%v resp=%#v", ok, resp)
	}
	if resp.Comment != "先不要改生产配置" {
		t.Fatalf("Comment = %q", resp.Comment)
	}
}
