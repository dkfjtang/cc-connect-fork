package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

var (
	ErrDecisionNotFound       = errors.New("decision not found")
	ErrDecisionResolved       = errors.New("decision already resolved")
	ErrDecisionTimeout        = errors.New("decision timed out")
	ErrDecisionInvalidChoice  = errors.New("invalid decision choice")
	ErrDecisionInvalidTimeout = errors.New("invalid decision timeout")
)

type DecisionAskRequest struct {
	Title            string        `json:"title"`
	Message          string        `json:"message"`
	Choices          []string      `json:"choices"`
	Recommended      string        `json:"recommended,omitempty"`
	Timeout          time.Duration `json:"-"`
	TimeoutMins      int           `json:"timeout_mins,omitempty"`
	EventKey         string        `json:"event_key,omitempty"`
	EventFingerprint string        `json:"event_fingerprint,omitempty"`
	CooldownMins     int           `json:"cooldown_mins,omitempty"`
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

type decisionEntry struct {
	decision  Decision
	choiceSet map[string]struct{}
	done      chan struct{}
	response  DecisionResponse
	resolved  bool
}

type DecisionStore struct {
	mu      sync.Mutex
	entries map[string]*decisionEntry
	now     func() time.Time
}

func NewDecisionStore() *DecisionStore {
	return &DecisionStore{entries: make(map[string]*decisionEntry), now: time.Now}
}

func (s *DecisionStore) Create(req DecisionAskRequest) (Decision, error) {
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return Decision{}, fmt.Errorf("title is required")
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		return Decision{}, fmt.Errorf("message is required")
	}
	choices := normalizeDecisionChoices(req.Choices)
	if len(choices) == 0 {
		return Decision{}, fmt.Errorf("at least one choice is required")
	}
	timeout := req.Timeout
	if timeout <= 0 && req.TimeoutMins != 0 {
		if req.TimeoutMins < 0 {
			return Decision{}, ErrDecisionInvalidTimeout
		}
		timeout = time.Duration(req.TimeoutMins) * time.Minute
	}
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}

	now := s.now()
	dec := Decision{
		ID:          "dec_" + randomDecisionHex(12),
		Title:       title,
		Message:     message,
		Choices:     choices,
		Recommended: strings.TrimSpace(req.Recommended),
		CreatedAt:   now,
		ExpiresAt:   now.Add(timeout),
	}
	choiceSet := make(map[string]struct{}, len(choices))
	for _, choice := range choices {
		choiceSet[choice] = struct{}{}
	}
	if dec.Recommended != "" {
		if _, ok := choiceSet[dec.Recommended]; !ok {
			return Decision{}, fmt.Errorf("recommended choice %q is not in choices", dec.Recommended)
		}
	}

	s.mu.Lock()
	s.entries[dec.ID] = &decisionEntry{decision: dec, choiceSet: choiceSet, done: make(chan struct{})}
	s.mu.Unlock()
	return dec, nil
}

func (s *DecisionStore) Get(id string) (Decision, bool) {
	dec, _, ok := s.Snapshot(id)
	return dec, ok
}

func (s *DecisionStore) Snapshot(id string) (Decision, *DecisionResponse, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ent, ok := s.entries[id]
	if !ok {
		return Decision{}, nil, false
	}
	if ent.resolved {
		resp := ent.response
		delete(s.entries, id)
		return ent.decision, &resp, true
	}
	return ent.decision, nil, true
}

func (s *DecisionStore) Expire(id string) (Decision, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ent, ok := s.entries[id]
	if !ok {
		return Decision{}, false
	}
	if !ent.resolved && !s.now().Before(ent.decision.ExpiresAt) {
		delete(s.entries, id)
		return ent.decision, true
	}
	return ent.decision, false
}

func (s *DecisionStore) Resolve(id string, resp DecisionResponse) error {
	choice := strings.TrimSpace(resp.Choice)
	comment := strings.TrimSpace(resp.Comment)

	s.mu.Lock()
	defer s.mu.Unlock()
	ent, ok := s.entries[id]
	if !ok {
		return ErrDecisionNotFound
	}
	if ent.resolved {
		return ErrDecisionResolved
	}
	if s.now().After(ent.decision.ExpiresAt) {
		return ErrDecisionTimeout
	}
	if _, ok := ent.choiceSet[choice]; !ok {
		return ErrDecisionInvalidChoice
	}
	ent.response = DecisionResponse{DecisionID: id, Choice: choice, Comment: comment}
	ent.resolved = true
	close(ent.done)
	return nil
}

func (s *DecisionStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, id)
}

func (s *DecisionStore) Wait(ctx context.Context, id string) (DecisionResponse, error) {
	s.mu.Lock()
	ent, ok := s.entries[id]
	if !ok {
		s.mu.Unlock()
		return DecisionResponse{}, ErrDecisionNotFound
	}
	if ent.resolved {
		resp := ent.response
		delete(s.entries, id)
		s.mu.Unlock()
		return resp, nil
	}
	done := ent.done
	expiresAt := ent.decision.ExpiresAt
	s.mu.Unlock()

	timer := time.NewTimer(time.Until(expiresAt))
	defer timer.Stop()
	select {
	case <-done:
		s.mu.Lock()
		resp := ent.response
		delete(s.entries, id)
		s.mu.Unlock()
		return resp, nil
	case <-timer.C:
		s.Delete(id)
		return DecisionResponse{}, ErrDecisionTimeout
	case <-ctx.Done():
		return DecisionResponse{}, ctx.Err()
	}
}

func normalizeDecisionChoices(raw []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, choice := range raw {
		choice = strings.TrimSpace(choice)
		if choice == "" {
			continue
		}
		if _, ok := seen[choice]; ok {
			continue
		}
		seen[choice] = struct{}{}
		out = append(out, choice)
	}
	return out
}

func randomDecisionHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	}
	return hex.EncodeToString(b)
}
