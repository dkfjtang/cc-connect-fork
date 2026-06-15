package core

import (
	"path/filepath"
	"testing"
	"time"
)

func TestNotificationLedgerDedupesSameFingerprintDuringCooldown(t *testing.T) {
	ledger := NewNotificationLedger("")
	now := time.Date(2026, 6, 15, 10, 0, 0, 0, time.UTC)
	ledger.now = func() time.Time { return now }

	if got := ledger.ShouldNotify("thread-1:blocked", "turn-1", 30*time.Minute); got.Deduped {
		t.Fatalf("first ShouldNotify deduped = true")
	}
	ledger.Record("thread-1:blocked", "turn-1", "dec_1", 30)
	got := ledger.ShouldNotify("thread-1:blocked", "turn-1", 30*time.Minute)
	if !got.Deduped {
		t.Fatalf("second ShouldNotify deduped = false")
	}
	if got.DecisionID != "dec_1" {
		t.Fatalf("DecisionID = %q", got.DecisionID)
	}
}

func TestNotificationLedgerAllowsNewFingerprint(t *testing.T) {
	ledger := NewNotificationLedger("")
	now := time.Date(2026, 6, 15, 10, 0, 0, 0, time.UTC)
	ledger.now = func() time.Time { return now }

	ledger.Record("thread-1:blocked", "turn-1", "dec_1", 30)
	if got := ledger.ShouldNotify("thread-1:blocked", "turn-2", 30*time.Minute); got.Deduped {
		t.Fatalf("new fingerprint ShouldNotify deduped = true")
	}
}

func TestNotificationLedgerPersistsEntries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notifications", "ledger.json")
	ledger := NewNotificationLedger(path)
	now := time.Date(2026, 6, 15, 10, 0, 0, 0, time.UTC)
	ledger.now = func() time.Time { return now }
	ledger.Record("thread-1:blocked", "turn-1", "dec_1", 30)

	reloaded := NewNotificationLedger(path)
	reloaded.now = func() time.Time { return now.Add(time.Minute) }
	got := reloaded.ShouldNotify("thread-1:blocked", "turn-1", 30*time.Minute)
	if !got.Deduped {
		t.Fatalf("reloaded ShouldNotify deduped = false")
	}
	if got.DecisionID != "dec_1" {
		t.Fatalf("DecisionID = %q", got.DecisionID)
	}
}
