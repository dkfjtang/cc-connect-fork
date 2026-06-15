package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"
)

var (
	ErrDecisionNotFound      = errors.New("decision not found")
	ErrDecisionResolved      = errors.New("decision already resolved")
	ErrDecisionTimeout       = errors.New("decision timed out")
	ErrDecisionInvalidChoice = errors.New("invalid decision choice")
)

const defaultDecisionTimeout = 30 * time.Minute

type DecisionAskRequest struct {
	Title       string        `json:"title"`
	Message     string        `json:"message"`
	Choices     []string      `json:"choices"`
	Recommended string        `json:"recommended,omitempty"`
	Timeout     time.Duration `json:"-"`
	TimeoutMins int           `json:"timeout_mins,omitempty"`
}

type Decision struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Message     string    `json:"message"`
	Choices     []string  `json:"choices"`
	Recommended string    `json:"recommended,omitempty"`
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
	mu      sync.Mutex
	entries map[string]*decisionEntry
}

type decisionEntry struct {
	decision Decision
	response *DecisionResponse
	done     chan struct{}
}

func NewDecisionStore() *DecisionStore {
	return &DecisionStore{entries: make(map[string]*decisionEntry)}
}

func (s *DecisionStore) Create(req DecisionAskRequest) (Decision, error) {
	choices := normalizeDecisionChoices(req.Choices)
	if len(choices) == 0 {
		return Decision{}, ErrDecisionInvalidChoice
	}
	recommended := strings.TrimSpace(req.Recommended)
	if recommended != "" && !decisionChoiceAllowed(recommended, choices) {
		return Decision{}, ErrDecisionInvalidChoice
	}
	timeout := req.Timeout
	if timeout <= 0 && req.TimeoutMins > 0 {
		timeout = time.Duration(req.TimeoutMins) * time.Minute
	}
	if timeout <= 0 {
		timeout = defaultDecisionTimeout
	}

	now := time.Now()
	dec := Decision{
		ID:          newDecisionID(),
		Title:       strings.TrimSpace(req.Title),
		Message:     strings.TrimSpace(req.Message),
		Choices:     choices,
		Recommended: recommended,
		CreatedAt:   now,
		ExpiresAt:   now.Add(timeout),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[dec.ID] = &decisionEntry{decision: dec, done: make(chan struct{})}
	return dec, nil
}

func (s *DecisionStore) Resolve(id string, resp DecisionResponse) error {
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
		if !ok || entry.response == nil {
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
