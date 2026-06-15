package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type NotificationLedger struct {
	mu      sync.Mutex
	path    string
	now     func() time.Time
	entries map[string]NotificationLedgerEntry
}

type NotificationLedgerEntry struct {
	EventKey     string    `json:"event_key"`
	Fingerprint  string    `json:"fingerprint"`
	DecisionID   string    `json:"decision_id,omitempty"`
	LastSentAt   time.Time `json:"last_sent_at"`
	CooldownMins int       `json:"cooldown_mins,omitempty"`
}

type NotificationDedupResult struct {
	Deduped      bool      `json:"deduped"`
	EventKey     string    `json:"event_key,omitempty"`
	Fingerprint  string    `json:"event_fingerprint,omitempty"`
	DecisionID   string    `json:"decision_id,omitempty"`
	CooldownEnds time.Time `json:"cooldown_ends_at,omitempty"`
}

func NewNotificationLedger(path string) *NotificationLedger {
	l := &NotificationLedger{
		path:    path,
		now:     time.Now,
		entries: make(map[string]NotificationLedgerEntry),
	}
	if path != "" {
		l.load()
	}
	return l
}

func (l *NotificationLedger) ShouldNotify(eventKey, fingerprint string, cooldown time.Duration) NotificationDedupResult {
	eventKey = strings.TrimSpace(eventKey)
	fingerprint = strings.TrimSpace(fingerprint)
	if eventKey == "" || fingerprint == "" || cooldown <= 0 {
		return NotificationDedupResult{}
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	ent, ok := l.entries[eventKey]
	if !ok || ent.Fingerprint != fingerprint {
		return NotificationDedupResult{EventKey: eventKey, Fingerprint: fingerprint}
	}
	cooldownEnds := ent.LastSentAt.Add(cooldown)
	if l.now().Before(cooldownEnds) {
		return NotificationDedupResult{
			Deduped:      true,
			EventKey:     eventKey,
			Fingerprint:  fingerprint,
			DecisionID:   ent.DecisionID,
			CooldownEnds: cooldownEnds,
		}
	}
	return NotificationDedupResult{EventKey: eventKey, Fingerprint: fingerprint}
}

func (l *NotificationLedger) Record(eventKey, fingerprint, decisionID string, cooldownMins int) {
	eventKey = strings.TrimSpace(eventKey)
	fingerprint = strings.TrimSpace(fingerprint)
	if eventKey == "" || fingerprint == "" {
		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries[eventKey] = NotificationLedgerEntry{
		EventKey:     eventKey,
		Fingerprint:  fingerprint,
		DecisionID:   strings.TrimSpace(decisionID),
		LastSentAt:   l.now(),
		CooldownMins: cooldownMins,
	}
	if err := l.saveLocked(); err != nil {
		slog.Warn("notification ledger: save failed", "error", err)
	}
}

func (l *NotificationLedger) load() {
	b, err := os.ReadFile(l.path)
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Warn("notification ledger: load failed", "error", err)
		}
		return
	}
	var entries map[string]NotificationLedgerEntry
	if err := json.Unmarshal(b, &entries); err != nil {
		slog.Warn("notification ledger: decode failed", "error", err)
		return
	}
	if entries != nil {
		l.entries = entries
	}
}

func (l *NotificationLedger) saveLocked() error {
	if l.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		return fmt.Errorf("create ledger dir: %w", err)
	}
	b, err := json.MarshalIndent(l.entries, "", "  ")
	if err != nil {
		return fmt.Errorf("encode ledger: %w", err)
	}
	return os.WriteFile(l.path, b, 0o600)
}
