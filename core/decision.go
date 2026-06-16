package core

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrDecisionNotFound            = errors.New("decision not found")
	ErrDecisionResolved            = errors.New("decision already resolved")
	ErrDecisionTimeout             = errors.New("decision timed out")
	ErrDecisionPendingNotification = errors.New("decision notification pending")
	ErrDecisionInvalidChoice       = errors.New("invalid decision choice")
)

const defaultDecisionTimeout = 30 * time.Minute
const resolvedDecisionRetention = 24 * time.Hour

type DecisionAskRequest struct {
	Title       string        `json:"title"`
	Message     string        `json:"message"`
	Choices     []string      `json:"choices"`
	Recommended string        `json:"recommended,omitempty"`
	Scope       string        `json:"scope,omitempty"`
	Timeout     time.Duration `json:"-"`
	TimeoutMins int           `json:"timeout_mins,omitempty"`
}

type Decision struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Message     string    `json:"message"`
	Choices     []string  `json:"choices"`
	Recommended string    `json:"recommended,omitempty"`
	Scope       string    `json:"scope,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

type DecisionResponse struct {
	DecisionID string `json:"decision_id,omitempty"`
	Choice     string `json:"choice"`
	Comment    string `json:"comment,omitempty"`
}

type DecisionRecord struct {
	Decision Decision          `json:"decision"`
	Response *DecisionResponse `json:"response,omitempty"`
}

type DecisionStore struct {
	mu            sync.Mutex
	entries       map[string]*decisionEntry
	pendingByKey  map[string]string
	creatingByKey map[string]string
	path          string
}

type decisionEntry struct {
	decision    Decision
	response    *DecisionResponse
	done        chan struct{}
	fingerprint string
	notified    bool
	aborted     bool
}

func NewDecisionStore() *DecisionStore {
	return &DecisionStore{
		entries:       make(map[string]*decisionEntry),
		pendingByKey:  make(map[string]string),
		creatingByKey: make(map[string]string),
	}
}

func (s *DecisionStore) Create(req DecisionAskRequest) (Decision, error) {
	dec, _, err := s.CreateOrReuse(req)
	return dec, err
}

func NewPersistentDecisionStore(dataDir string) (*DecisionStore, error) {
	store := NewDecisionStore()
	store.path = filepath.Join(dataDir, "decisions", "decisions.json")
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *DecisionStore) CreateOrReuse(req DecisionAskRequest) (Decision, bool, error) {
	choices := normalizeDecisionChoices(req.Choices)
	if len(choices) == 0 {
		return Decision{}, false, ErrDecisionInvalidChoice
	}
	recommended := strings.TrimSpace(req.Recommended)
	if recommended != "" && !decisionChoiceAllowed(recommended, choices) {
		return Decision{}, false, ErrDecisionInvalidChoice
	}
	timeout := req.Timeout
	if timeout <= 0 && req.TimeoutMins > 0 {
		timeout = time.Duration(req.TimeoutMins) * time.Minute
	}
	if timeout <= 0 {
		timeout = defaultDecisionTimeout
	}
	scope := strings.TrimSpace(req.Scope)
	fingerprint := decisionRequestFingerprint(scope, strings.TrimSpace(req.Title), strings.TrimSpace(req.Message), choices, recommended, timeout)

	now := time.Now()
	dec := Decision{
		ID:          newDecisionID(),
		Title:       strings.TrimSpace(req.Title),
		Message:     strings.TrimSpace(req.Message),
		Choices:     choices,
		Recommended: recommended,
		Scope:       scope,
		CreatedAt:   now,
		ExpiresAt:   now.Add(timeout),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if existingID, ok := s.pendingByKey[fingerprint]; ok {
		if entry, ok := s.entries[existingID]; ok {
			if entry.notified && entry.response == nil && !entry.aborted && time.Now().Before(entry.decision.ExpiresAt) {
				return entry.decision, false, nil
			}
		}
		delete(s.pendingByKey, fingerprint)
	}
	if existingID, ok := s.creatingByKey[fingerprint]; ok {
		if entry, ok := s.entries[existingID]; ok && !entry.notified && !entry.aborted {
			if time.Now().After(entry.decision.ExpiresAt) {
				delete(s.creatingByKey, fingerprint)
			} else {
				return Decision{}, false, ErrDecisionPendingNotification
			}
		}
		delete(s.creatingByKey, fingerprint)
	}
	s.entries[dec.ID] = &decisionEntry{decision: dec, done: make(chan struct{}), fingerprint: fingerprint}
	s.creatingByKey[fingerprint] = dec.ID
	if err := s.saveLocked(); err != nil {
		delete(s.entries, dec.ID)
		delete(s.creatingByKey, fingerprint)
		return Decision{}, false, err
	}
	return dec, true, nil
}

func (s *DecisionStore) Resolve(id string, resp DecisionResponse) error {
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[id]
	if !ok {
		return ErrDecisionNotFound
	}
	if entry.aborted {
		return ErrDecisionNotFound
	}
	if time.Now().After(entry.decision.ExpiresAt) {
		return ErrDecisionTimeout
	}
	if entry.response != nil {
		return ErrDecisionResolved
	}
	choice := strings.TrimSpace(resp.Choice)
	if !decisionChoiceAllowed(choice, entry.decision.Choices) {
		return ErrDecisionInvalidChoice
	}
	resolved := DecisionResponse{
		DecisionID: id,
		Choice:     choice,
		Comment:    strings.TrimSpace(resp.Comment),
	}
	entry.response = &resolved
	removedPending := false
	if entry.fingerprint != "" {
		if currentID, ok := s.pendingByKey[entry.fingerprint]; ok && currentID == id {
			delete(s.pendingByKey, entry.fingerprint)
			removedPending = true
		}
	}
	if err := s.saveLocked(); err != nil {
		entry.response = nil
		if removedPending {
			s.pendingByKey[entry.fingerprint] = id
		}
		return err
	}
	close(entry.done)
	return nil
}

func (s *DecisionStore) MarkNotified(id string) error {
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[id]
	if !ok {
		return ErrDecisionNotFound
	}
	if entry.response != nil {
		return ErrDecisionResolved
	}
	if entry.aborted {
		return ErrDecisionNotFound
	}
	entry.notified = true
	if entry.fingerprint != "" {
		delete(s.creatingByKey, entry.fingerprint)
		s.pendingByKey[entry.fingerprint] = id
	}
	if err := s.saveLocked(); err != nil {
		// The external card may already be delivered by the time this runs.
		// Keep the in-memory notified state so the same process reuses that
		// card instead of sending duplicate prompts; a restart will reload the
		// last durable state and may send a replacement card.
		return err
	}
	return nil
}

func (s *DecisionStore) AbortUnresolved(id string) error {
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[id]
	if !ok {
		return ErrDecisionNotFound
	}
	if entry.response != nil {
		return ErrDecisionResolved
	}
	if entry.aborted {
		return ErrDecisionNotFound
	}

	entry.aborted = true
	if entry.fingerprint != "" {
		if currentID, ok := s.pendingByKey[entry.fingerprint]; ok && currentID == id {
			delete(s.pendingByKey, entry.fingerprint)
		}
		if currentID, ok := s.creatingByKey[entry.fingerprint]; ok && currentID == id {
			delete(s.creatingByKey, entry.fingerprint)
		}
	}
	if err := s.saveLocked(); err != nil {
		// No external card was delivered on abort paths. Prefer keeping the
		// runtime state cleared so retries can create a fresh notification,
		// even if the durable abort marker could not be written.
		return err
	}
	close(entry.done)
	return nil
}

func (s *DecisionStore) Wait(ctx context.Context, id string) (DecisionResponse, error) {
	id = strings.TrimSpace(id)
	s.mu.Lock()
	entry, ok := s.entries[id]
	if !ok {
		s.mu.Unlock()
		return DecisionResponse{}, ErrDecisionNotFound
	}
	if entry.aborted {
		s.mu.Unlock()
		return DecisionResponse{}, ErrDecisionNotFound
	}
	if time.Now().After(entry.decision.ExpiresAt) {
		s.mu.Unlock()
		return DecisionResponse{}, ErrDecisionTimeout
	}
	if entry.response != nil {
		resp := *entry.response
		s.mu.Unlock()
		return resp, nil
	}
	done := entry.done
	expiresAt := entry.decision.ExpiresAt
	s.mu.Unlock()

	timer := time.NewTimer(time.Until(expiresAt))
	defer timer.Stop()

	select {
	case <-done:
		s.mu.Lock()
		defer s.mu.Unlock()
		entry, ok := s.entries[id]
		if !ok || entry.aborted {
			return DecisionResponse{}, ErrDecisionNotFound
		}
		if entry.response == nil {
			return DecisionResponse{}, ErrDecisionNotFound
		}
		return *entry.response, nil
	case <-timer.C:
		return DecisionResponse{}, ErrDecisionTimeout
	case <-ctx.Done():
		return DecisionResponse{}, ctx.Err()
	}
}

func (s *DecisionStore) Get(id string) (DecisionRecord, error) {
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[id]
	if !ok {
		return DecisionRecord{}, ErrDecisionNotFound
	}
	record := DecisionRecord{Decision: entry.decision}
	if entry.response != nil {
		resp := *entry.response
		record.Response = &resp
	}
	return record, nil
}

func normalizeDecisionChoices(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	var out []string
	for _, raw := range in {
		choice := strings.TrimSpace(raw)
		if choice == "" {
			continue
		}
		key := strings.ToLower(choice)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, choice)
	}
	return out
}

func decisionChoiceAllowed(choice string, choices []string) bool {
	choice = strings.TrimSpace(choice)
	if choice == "" {
		return false
	}
	for _, allowed := range choices {
		if strings.EqualFold(strings.TrimSpace(allowed), choice) {
			return true
		}
	}
	return false
}

func newDecisionID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "dec_" + hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return "dec_" + hex.EncodeToString(b[:])
}

type persistedDecisionStore struct {
	Records []persistedDecisionRecord `json:"records"`
}

type persistedDecisionRecord struct {
	Decision    Decision          `json:"decision"`
	Response    *DecisionResponse `json:"response,omitempty"`
	Fingerprint string            `json:"fingerprint,omitempty"`
	Notified    *bool             `json:"notified,omitempty"`
	Aborted     bool              `json:"aborted,omitempty"`
}

func (s *DecisionStore) load() error {
	if strings.TrimSpace(s.path) == "" {
		return nil
	}
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var persisted persistedDecisionStore
	if err := json.Unmarshal(b, &persisted); err != nil {
		if legacy, legacyErr := decodeLegacyDecisionRecords(b); legacyErr == nil {
			persisted.Records = legacy
		} else {
			return err
		}
	}
	if len(persisted.Records) == 0 {
		if legacy, legacyErr := decodeLegacyDecisionRecords(b); legacyErr == nil {
			persisted.Records = legacy
		}
	}
	now := time.Now()
	for _, record := range persisted.Records {
		dec := record.Decision
		if dec.ID == "" {
			continue
		}
		notified := record.Notified != nil && *record.Notified
		entry := &decisionEntry{
			decision:    dec,
			response:    record.Response,
			done:        make(chan struct{}),
			fingerprint: record.Fingerprint,
			notified:    notified,
			aborted:     record.Aborted,
		}
		if shouldPruneDecisionEntry(entry, now) {
			continue
		}
		if entry.response != nil {
			close(entry.done)
		}
		s.entries[dec.ID] = entry
		if record.Fingerprint != "" && record.Response == nil && !record.Aborted && notified && now.Before(dec.ExpiresAt) {
			s.pendingByKey[record.Fingerprint] = dec.ID
		}
	}
	return nil
}

func decodeLegacyDecisionRecords(b []byte) ([]persistedDecisionRecord, error) {
	var records []persistedDecisionRecord
	if err := json.Unmarshal(b, &records); err == nil && len(records) > 0 {
		backfillPersistedResponseDecisionIDs(records)
		return records, nil
	}
	var single persistedDecisionRecord
	if err := json.Unmarshal(b, &single); err == nil && single.Decision.ID != "" {
		backfillResponseDecisionID(single.Decision.ID, single.Response)
		return []persistedDecisionRecord{single}, nil
	}
	var decisionRecords []DecisionRecord
	if err := json.Unmarshal(b, &decisionRecords); err == nil && len(decisionRecords) > 0 {
		out := make([]persistedDecisionRecord, 0, len(decisionRecords))
		for _, record := range decisionRecords {
			if record.Decision.ID == "" {
				continue
			}
			backfillResponseDecisionID(record.Decision.ID, record.Response)
			out = append(out, persistedDecisionRecord{Decision: record.Decision, Response: record.Response})
		}
		if len(out) > 0 {
			return out, nil
		}
	}
	var decisionRecord DecisionRecord
	if err := json.Unmarshal(b, &decisionRecord); err == nil && decisionRecord.Decision.ID != "" {
		backfillResponseDecisionID(decisionRecord.Decision.ID, decisionRecord.Response)
		return []persistedDecisionRecord{{Decision: decisionRecord.Decision, Response: decisionRecord.Response}}, nil
	}
	return nil, ErrDecisionNotFound
}

func backfillPersistedResponseDecisionIDs(records []persistedDecisionRecord) {
	for i := range records {
		backfillResponseDecisionID(records[i].Decision.ID, records[i].Response)
	}
}

func backfillResponseDecisionID(id string, resp *DecisionResponse) {
	if resp != nil && strings.TrimSpace(resp.DecisionID) == "" {
		resp.DecisionID = id
	}
}

func (s *DecisionStore) saveLocked() error {
	if strings.TrimSpace(s.path) == "" {
		return nil
	}
	now := time.Now()
	var persisted persistedDecisionStore
	for _, entry := range s.entries {
		if shouldPruneDecisionEntry(entry, now) {
			continue
		}
		resp := entry.response
		if resp != nil {
			copyResp := *resp
			resp = &copyResp
		}
		notified := entry.notified
		persisted.Records = append(persisted.Records, persistedDecisionRecord{
			Decision:    entry.decision,
			Response:    resp,
			Fingerprint: entry.fingerprint,
			Notified:    &notified,
			Aborted:     entry.aborted,
		})
	}
	b, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	return AtomicWriteFile(s.path, b, 0o600)
}

func shouldPruneDecisionEntry(entry *decisionEntry, now time.Time) bool {
	if entry == nil {
		return true
	}
	if entry.response == nil && !entry.aborted && now.Before(entry.decision.ExpiresAt) {
		return false
	}
	return now.After(entry.decision.ExpiresAt.Add(resolvedDecisionRetention))
}

func decisionRequestFingerprint(scope, title, message string, choices []string, recommended string, timeout time.Duration) string {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(scope))
	b.WriteByte('\n')
	b.WriteString(strings.TrimSpace(title))
	b.WriteByte('\n')
	b.WriteString(strings.TrimSpace(message))
	b.WriteByte('\n')
	for i, choice := range choices {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strings.ToLower(strings.TrimSpace(choice)))
	}
	b.WriteByte('\n')
	b.WriteString(strings.ToLower(strings.TrimSpace(recommended)))
	b.WriteByte('\n')
	b.WriteString(timeout.String())
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}
