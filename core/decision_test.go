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
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	waitCh := make(chan DecisionResponse, 1)
	errCh := make(chan error, 1)
	go func() {
		resp, err := store.Wait(context.Background(), dec.ID)
		if err != nil {
			errCh <- err
			return
		}
		waitCh <- resp
	}()

	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "continue", Comment: "Ship it."}); err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	select {
	case err := <-errCh:
		t.Fatalf("Wait error: %v", err)
	case got := <-waitCh:
		if got.DecisionID != dec.ID {
			t.Fatalf("DecisionID = %q, want %q", got.DecisionID, dec.ID)
		}
		if got.Choice != "continue" || got.Comment != "Ship it." {
			t.Fatalf("response = %#v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for waiter to wake")
	}
}

func TestDecisionStoreRejectsSecondResolve(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "continue"}); err != nil {
		t.Fatalf("first Resolve: %v", err)
	}
	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "abort"}); !errors.Is(err, ErrDecisionResolved) {
		t.Fatalf("second Resolve error = %v, want ErrDecisionResolved", err)
	}
}

func TestDecisionStoreWaitTimeout(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	_, err = store.Wait(context.Background(), dec.ID)
	if !errors.Is(err, ErrDecisionTimeout) {
		t.Fatalf("Wait error = %v, want ErrDecisionTimeout", err)
	}
}

func TestDecisionStoreValidatesChoice(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "revise"}); !errors.Is(err, ErrDecisionInvalidChoice) {
		t.Fatalf("Resolve error = %v, want ErrDecisionInvalidChoice", err)
	}
}

func TestDecisionStorePreservesComment(t *testing.T) {
	store := NewDecisionStore()
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "continue", Comment: "Use proxy if slow."}); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	got, err := store.Get(dec.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Response == nil || got.Response.Comment != "Use proxy if slow." {
		t.Fatalf("stored response = %#v", got.Response)
	}
}
