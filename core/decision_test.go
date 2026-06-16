package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
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
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
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
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
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
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
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
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
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

func TestDecisionStoreReusesMatchingPendingDecision(t *testing.T) {
	store := NewDecisionStore()
	req := DecisionAskRequest{
		Title:       "Need confirmation",
		Message:     "Proceed?",
		Choices:     []string{"continue", "abort"},
		Recommended: "continue",
		Timeout:     time.Minute,
	}

	first, created, err := store.CreateOrReuse(req)
	if err != nil {
		t.Fatalf("first CreateOrReuse: %v", err)
	}
	if !created {
		t.Fatal("first CreateOrReuse returned created=false")
	}
	if err := store.MarkNotified(first.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
	}
	second, created, err := store.CreateOrReuse(req)
	if err != nil {
		t.Fatalf("second CreateOrReuse: %v", err)
	}
	if created {
		t.Fatal("second CreateOrReuse returned created=true for matching pending decision")
	}
	if second.ID != first.ID {
		t.Fatalf("second ID = %q, want %q", second.ID, first.ID)
	}
}

func TestDecisionStoreDoesNotReuseAcrossScopes(t *testing.T) {
	store := NewDecisionStore()
	req := DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
		Scope:   "project=a;session=one",
	}

	first, created, err := store.CreateOrReuse(req)
	if err != nil {
		t.Fatalf("first CreateOrReuse: %v", err)
	}
	if !created {
		t.Fatal("first CreateOrReuse returned created=false")
	}
	if err := store.MarkNotified(first.ID); err != nil {
		t.Fatalf("MarkNotified first: %v", err)
	}

	req.Scope = "project=a;session=two"
	second, created, err := store.CreateOrReuse(req)
	if err != nil {
		t.Fatalf("second CreateOrReuse: %v", err)
	}
	if !created {
		t.Fatal("second CreateOrReuse returned created=false across scopes")
	}
	if second.ID == first.ID {
		t.Fatalf("second ID reused across scopes: %q", second.ID)
	}
}

func TestDecisionStoreEmptyScopeRemainsFunctional(t *testing.T) {
	store := NewDecisionStore()
	req := DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	}
	first, created, err := store.CreateOrReuse(req)
	if err != nil {
		t.Fatalf("first CreateOrReuse: %v", err)
	}
	if !created {
		t.Fatal("first CreateOrReuse returned created=false")
	}
	if err := store.MarkNotified(first.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
	}
	second, created, err := store.CreateOrReuse(req)
	if err != nil {
		t.Fatalf("second CreateOrReuse: %v", err)
	}
	if created {
		t.Fatal("second CreateOrReuse returned created=true for empty scope reuse")
	}
	if second.ID != first.ID {
		t.Fatalf("second ID = %q, want %q", second.ID, first.ID)
	}
}

func TestDecisionStoreDoesNotReuseBeforeNotification(t *testing.T) {
	store := NewDecisionStore()
	req := DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	}

	if _, created, err := store.CreateOrReuse(req); err != nil || !created {
		t.Fatalf("first CreateOrReuse created=%v err=%v", created, err)
	}
	if _, _, err := store.CreateOrReuse(req); !errors.Is(err, ErrDecisionPendingNotification) {
		t.Fatalf("second CreateOrReuse error = %v, want ErrDecisionPendingNotification", err)
	}
}

func TestDecisionStoreAbortUnresolvedWakesWaiter(t *testing.T) {
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
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		_, err := store.Wait(context.Background(), dec.ID)
		errCh <- err
	}()

	if err := store.AbortUnresolved(dec.ID); err != nil {
		t.Fatalf("AbortUnresolved: %v", err)
	}

	select {
	case err := <-errCh:
		if !errors.Is(err, ErrDecisionNotFound) {
			t.Fatalf("Wait error = %v, want ErrDecisionNotFound", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for waiter to wake")
	}
}

func TestDecisionStoreCreateSaveFailureDoesNotCommitInMemory(t *testing.T) {
	dir := t.TempDir()
	blocked := filepath.Join(dir, "blocked")
	if err := os.MkdirAll(blocked, 0o755); err != nil {
		t.Fatalf("mkdir blocked: %v", err)
	}
	store := NewDecisionStore()
	store.path = blocked
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err == nil {
		t.Fatal("Create should fail when persistent path is a directory")
	}
	if dec.ID != "" {
		t.Fatalf("Create returned decision despite save failure: %#v", dec)
	}
}

func TestDecisionStoreResolveSaveFailureDoesNotCommitInMemory(t *testing.T) {
	dir := t.TempDir()
	store, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("NewPersistentDecisionStore: %v", err)
	}
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
	}
	blocked := filepath.Join(dir, "blocked")
	if err := os.MkdirAll(blocked, 0o755); err != nil {
		t.Fatalf("mkdir blocked: %v", err)
	}
	store.path = blocked
	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "continue"}); err == nil {
		t.Fatal("Resolve should fail when persistent path is a directory")
	}
	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "revise"}); !errors.Is(err, ErrDecisionInvalidChoice) {
		t.Fatalf("second Resolve error = %v, want ErrDecisionInvalidChoice instead of committed response", err)
	}
}

func TestDecisionStoreMarkNotifiedSaveFailureKeepsDeliveredCardReusable(t *testing.T) {
	dir := t.TempDir()
	store, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("NewPersistentDecisionStore: %v", err)
	}
	req := DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	}
	dec, err := store.Create(req)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	blocked := filepath.Join(dir, "blocked-mark")
	if err := os.MkdirAll(blocked, 0o755); err != nil {
		t.Fatalf("mkdir blocked: %v", err)
	}
	store.path = blocked
	if err := store.MarkNotified(dec.ID); err == nil {
		t.Fatal("MarkNotified should fail when persistent path is a directory")
	}
	reused, created, err := store.CreateOrReuse(req)
	if err != nil {
		t.Fatalf("CreateOrReuse after failed MarkNotified: %v", err)
	}
	if created {
		t.Fatal("CreateOrReuse should reuse delivered card after failed MarkNotified")
	}
	if reused.ID != dec.ID {
		t.Fatalf("reused ID = %q, want %q", reused.ID, dec.ID)
	}
	store.path = filepath.Join(dir, "decisions", "decisions.json")
	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "continue"}); err != nil {
		t.Fatalf("Resolve should stay usable after MarkNotified save failure: %v", err)
	}
}

func TestDecisionStoreAbortUnresolvedSaveFailureClearsRuntimeState(t *testing.T) {
	dir := t.TempDir()
	store, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("NewPersistentDecisionStore: %v", err)
	}
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
	}
	blocked := filepath.Join(dir, "blocked-abort")
	if err := os.MkdirAll(blocked, 0o755); err != nil {
		t.Fatalf("mkdir blocked: %v", err)
	}
	store.path = blocked
	if err := store.AbortUnresolved(dec.ID); err == nil {
		t.Fatal("AbortUnresolved should fail when persistent path is a directory")
	}
	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "continue"}); !errors.Is(err, ErrDecisionNotFound) {
		t.Fatalf("Resolve error = %v, want ErrDecisionNotFound after runtime abort", err)
	}
	store.path = filepath.Join(dir, "decisions", "decisions.json")
	next, created, err := store.CreateOrReuse(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("CreateOrReuse after failed abort: %v", err)
	}
	if !created {
		t.Fatal("CreateOrReuse after failed abort should create a fresh decision")
	}
	if next.ID == dec.ID {
		t.Fatalf("CreateOrReuse reused aborted decision %q", dec.ID)
	}
}

func TestPersistentDecisionStoreReloadsPendingDecision(t *testing.T) {
	dir := t.TempDir()
	store, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("NewPersistentDecisionStore: %v", err)
	}
	dec, created, err := store.CreateOrReuse(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("CreateOrReuse: %v", err)
	}
	if !created {
		t.Fatal("CreateOrReuse returned created=false")
	}
	if err := store.MarkNotified(dec.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
	}

	reloaded, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("reload NewPersistentDecisionStore: %v", err)
	}
	if err := reloaded.Resolve(dec.ID, DecisionResponse{Choice: "continue", Comment: "after restart"}); err != nil {
		t.Fatalf("Resolve after reload: %v", err)
	}
	got, err := reloaded.Get(dec.ID)
	if err != nil {
		t.Fatalf("Get after reload: %v", err)
	}
	if got.Response == nil || got.Response.Comment != "after restart" {
		t.Fatalf("reloaded response = %#v", got.Response)
	}
}

func TestPersistentDecisionStoreReloadReusesNotifiedPendingDecision(t *testing.T) {
	dir := t.TempDir()
	store, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("NewPersistentDecisionStore: %v", err)
	}
	req := DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	}
	first, created, err := store.CreateOrReuse(req)
	if err != nil {
		t.Fatalf("CreateOrReuse: %v", err)
	}
	if !created {
		t.Fatal("CreateOrReuse returned created=false")
	}
	if err := store.MarkNotified(first.ID); err != nil {
		t.Fatalf("MarkNotified: %v", err)
	}

	reloaded, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("reload NewPersistentDecisionStore: %v", err)
	}
	second, created, err := reloaded.CreateOrReuse(req)
	if err != nil {
		t.Fatalf("reloaded CreateOrReuse: %v", err)
	}
	if created {
		t.Fatal("reloaded CreateOrReuse returned created=true")
	}
	if second.ID != first.ID {
		t.Fatalf("reloaded ID = %q, want %q", second.ID, first.ID)
	}
}

func TestPersistentDecisionStoreReloadKeepsUnnotifiedDecisionResolvableWithoutReuse(t *testing.T) {
	dir := t.TempDir()
	store, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("NewPersistentDecisionStore: %v", err)
	}
	dec, err := store.Create(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	reloaded, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("reload NewPersistentDecisionStore: %v", err)
	}
	next, created, err := reloaded.CreateOrReuse(DecisionAskRequest{
		Title:   "Need confirmation",
		Message: "Proceed?",
		Choices: []string{"continue", "abort"},
		Timeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("CreateOrReuse after reload: %v", err)
	}
	if !created {
		t.Fatal("CreateOrReuse after reload returned created=false")
	}
	if next.ID == dec.ID {
		t.Fatalf("CreateOrReuse reused unnotified decision %q", dec.ID)
	}
	if err := reloaded.Resolve(dec.ID, DecisionResponse{Choice: "continue"}); err != nil {
		t.Fatalf("Resolve after reload: %v", err)
	}
}

func TestPersistentDecisionStoreLoadsLegacySingleRecord(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "decisions", "decisions.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir decisions dir: %v", err)
	}
	dec := Decision{
		ID:        "dec_legacy",
		Title:     "Need confirmation",
		Message:   "Proceed?",
		Choices:   []string{"continue", "abort"},
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(time.Minute),
	}
	body, err := json.Marshal(DecisionRecord{Decision: dec})
	if err != nil {
		t.Fatalf("marshal legacy record: %v", err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatalf("write legacy file: %v", err)
	}

	store, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("NewPersistentDecisionStore: %v", err)
	}
	if err := store.Resolve(dec.ID, DecisionResponse{Choice: "continue"}); err != nil {
		t.Fatalf("Resolve legacy decision: %v", err)
	}
}

func TestPersistentDecisionStoreBackfillsLegacyResponseDecisionID(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "decisions", "decisions.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir decisions dir: %v", err)
	}
	dec := Decision{
		ID:        "dec_legacy_response",
		Title:     "Need confirmation",
		Message:   "Proceed?",
		Choices:   []string{"continue", "abort"},
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(time.Minute),
	}
	body, err := json.Marshal(DecisionRecord{
		Decision: dec,
		Response: &DecisionResponse{
			Choice:  "continue",
			Comment: "legacy response",
		},
	})
	if err != nil {
		t.Fatalf("marshal legacy record: %v", err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatalf("write legacy file: %v", err)
	}

	store, err := NewPersistentDecisionStore(dir)
	if err != nil {
		t.Fatalf("NewPersistentDecisionStore: %v", err)
	}
	got, err := store.Get(dec.ID)
	if err != nil {
		t.Fatalf("Get legacy decision: %v", err)
	}
	if got.Response == nil || got.Response.DecisionID != dec.ID {
		t.Fatalf("legacy response decision_id = %#v, want %q", got.Response, dec.ID)
	}
}
