package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type decisionCLIOptions struct {
	DataDir    string
	ConfigPath string
	Wait       bool
}

var errDecisionUsage = errors.New("show decision usage")

func runDecision(args []string) {
	if len(args) == 0 {
		printDecisionUsage()
		return
	}
	switch args[0] {
	case "ask":
		runDecisionAsk(args[1:])
	case "--help", "-h":
		printDecisionUsage()
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown decision subcommand %q\n", args[0])
		printDecisionUsage()
		os.Exit(1)
	}
}

func runDecisionAsk(args []string) {
	req, opts, err := parseDecisionAskArgs(args)
	if err != nil {
		if errors.Is(err, errDecisionUsage) {
			printDecisionUsage()
			return
		}
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		printDecisionUsage()
		os.Exit(1)
	}

	sockPath := resolveSocketPathFromOptions(socketPathOptions{DataDir: opts.DataDir, ConfigPath: opts.ConfigPath})
	if _, err := os.Stat(sockPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Error: cc-connect is not running (socket not found: %s)\n", sockPath)
		os.Exit(1)
	}

	client := decisionHTTPClient(sockPath)
	payload, err := json.Marshal(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to encode decision payload: %v\n", err)
		os.Exit(1)
	}
	resp, err := client.Post("http://unix/decision/ask", "application/json", bytes.NewReader(payload))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to connect: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusAlreadyReported {
		fmt.Print(formatDecisionDedupedCLIResponse(body))
		return
	}
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "Error: %s\n", strings.TrimSpace(string(body)))
		os.Exit(1)
	}
	var dec core.Decision
	if err := json.Unmarshal(body, &dec); err != nil {
		fmt.Fprintf(os.Stderr, "Error: decode decision response: %v\n", err)
		os.Exit(1)
	}
	if !opts.Wait {
		fmt.Printf("decision_id=%s\n", dec.ID)
		return
	}

	waitCtx, cancel := context.WithTimeout(context.Background(), time.Duration(req.TimeoutMins)*time.Minute+5*time.Second)
	defer cancel()
	decisionResp, err := waitForDecision(waitCtx, client, dec.ID, time.Second)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	fmt.Print(formatDecisionCLIResponse(decisionResp.Choice, decisionResp.Comment))
}

func parseDecisionAskArgs(args []string) (core.DecisionAskRequest, decisionCLIOptions, error) {
	req := core.DecisionAskRequest{TimeoutMins: 30}
	var opts decisionCLIOptions
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--title":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--title requires a value")
			}
			i++
			req.Title = args[i]
		case "--message", "-m":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--message requires a value")
			}
			i++
			req.Message = args[i]
		case "--choices":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--choices requires a value")
			}
			i++
			req.Choices = splitDecisionCSV(args[i])
		case "--recommended":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--recommended requires a value")
			}
			i++
			req.Recommended = args[i]
		case "--timeout-mins":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--timeout-mins requires a value")
			}
			i++
			n, err := strconv.Atoi(args[i])
			if err != nil || n <= 0 {
				return req, opts, fmt.Errorf("--timeout-mins must be a positive integer")
			}
			req.TimeoutMins = n
		case "--event-key":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--event-key requires a value")
			}
			i++
			req.EventKey = strings.TrimSpace(args[i])
		case "--event-fingerprint":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--event-fingerprint requires a value")
			}
			i++
			req.EventFingerprint = strings.TrimSpace(args[i])
		case "--cooldown-mins":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--cooldown-mins requires a value")
			}
			i++
			n, err := strconv.Atoi(args[i])
			if err != nil || n < 0 {
				return req, opts, fmt.Errorf("--cooldown-mins must be a non-negative integer")
			}
			req.CooldownMins = n
		case "--wait":
			opts.Wait = true
		case "--data-dir":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--data-dir requires a value")
			}
			i++
			opts.DataDir = args[i]
		case "--config":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--config requires a value")
			}
			i++
			opts.ConfigPath = args[i]
		case "--help", "-h":
			return req, opts, errDecisionUsage
		default:
			return req, opts, fmt.Errorf("unknown argument %q", args[i])
		}
	}
	if strings.TrimSpace(req.Title) == "" {
		return req, opts, fmt.Errorf("--title is required")
	}
	if strings.TrimSpace(req.Message) == "" {
		return req, opts, fmt.Errorf("--message is required")
	}
	if len(req.Choices) == 0 {
		return req, opts, fmt.Errorf("--choices is required")
	}
	return req, opts, nil
}

func splitDecisionCSV(s string) []string {
	var out []string
	for _, item := range strings.Split(s, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func decisionHTTPClient(sockPath string) *http.Client {
	return &http.Client{Transport: &http.Transport{DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
		return net.Dial("unix", sockPath)
	}}}
}

func waitForDecision(ctx context.Context, client *http.Client, id string, interval time.Duration) (core.DecisionResponse, error) {
	return waitForDecisionAt(ctx, client, "http://unix", id, interval)
}

func waitForDecisionAt(ctx context.Context, client *http.Client, baseURL, id string, interval time.Duration) (core.DecisionResponse, error) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return core.DecisionResponse{}, ctx.Err()
		case <-ticker.C:
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/decision/get?id="+id, nil)
			resp, err := client.Do(req)
			if err != nil {
				return core.DecisionResponse{}, err
			}
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				return core.DecisionResponse{}, fmt.Errorf("%s", strings.TrimSpace(string(body)))
			}
			var snapshot struct {
				Decision core.Decision          `json:"decision"`
				Response *core.DecisionResponse `json:"response,omitempty"`
			}
			if err := json.Unmarshal(body, &snapshot); err != nil {
				return core.DecisionResponse{}, err
			}
			if !snapshot.Decision.ExpiresAt.IsZero() && time.Now().After(snapshot.Decision.ExpiresAt) {
				return core.DecisionResponse{}, core.ErrDecisionTimeout
			}
			if snapshot.Response != nil {
				return *snapshot.Response, nil
			}
		}
	}
}

func formatDecisionCLIResponse(choice, comment string) string {
	return fmt.Sprintf("choice=%s\ncomment=%q\n", strings.TrimSpace(choice), strings.TrimSpace(comment))
}

func formatDecisionDedupedCLIResponse(body []byte) string {
	var result core.NotificationDedupResult
	if err := json.Unmarshal(body, &result); err != nil {
		return "notification=deduped\n"
	}
	var b strings.Builder
	b.WriteString("notification=deduped\n")
	if result.EventKey != "" {
		fmt.Fprintf(&b, "event_key=%q\n", result.EventKey)
	}
	if result.Fingerprint != "" {
		fmt.Fprintf(&b, "event_fingerprint=%q\n", result.Fingerprint)
	}
	if result.DecisionID != "" {
		fmt.Fprintf(&b, "decision_id=%s\n", result.DecisionID)
	}
	if !result.CooldownEnds.IsZero() {
		fmt.Fprintf(&b, "cooldown_ends_at=%s\n", result.CooldownEnds.Format(time.RFC3339))
	}
	return b.String()
}

func printDecisionUsage() {
	fmt.Println(`Usage:
  cc-connect decision ask --title <text> --message <text> --choices continue,abort,revise,ignore,remind_later,reconnect [--recommended continue] [--timeout-mins 30] [--event-key key --event-fingerprint fp --cooldown-mins 30] [--config path | --data-dir dir] [--wait]

Examples:
  cc-connect decision ask --title "需要确认" --message "测试失败，需要改方案吗？" --choices "continue,abort,revise,ignore,remind_later,reconnect" --wait`)
}
