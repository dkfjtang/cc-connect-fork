package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type decisionAskOptions struct {
	dataDir    string
	configPath string
	wait       bool
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
	case "--help", "-h", "help":
		printDecisionUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown decision subcommand: %s\n", args[0])
		printDecisionUsage()
		os.Exit(1)
	}
}

func runDecisionAsk(args []string) {
	req, opts, err := parseDecisionAskArgs(args)
	if err != nil {
		if errors.Is(err, errDecisionUsage) {
			printDecisionAskUsage()
			return
		}
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		printDecisionAskUsage()
		os.Exit(1)
	}
	sockPath := resolveSocketPathFromOptions(socketPathOptions{DataDir: opts.dataDir, ConfigPath: opts.configPath})
	if _, err := os.Stat(sockPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Error: cc-connect is not running (socket not found: %s)\n", sockPath)
		os.Exit(1)
	}
	payload, err := json.Marshal(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to encode decision request: %v\n", err)
		os.Exit(1)
	}
	resp, err := apiPost(sockPath, "/decision/ask", payload)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer closeDecisionResponseBody(resp.Body)
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "Error: %s\n", strings.TrimSpace(string(body)))
		os.Exit(1)
	}
	var dec core.Decision
	if err := json.Unmarshal(body, &dec); err != nil {
		fmt.Fprintf(os.Stderr, "Error: invalid decision response: %v\n", err)
		os.Exit(1)
	}
	if !opts.wait {
		fmt.Println(dec.ID)
		return
	}
	answer, err := waitForDecisionResponse(sockPath, dec.ID, time.Until(dec.ExpiresAt))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	fmt.Print(formatDecisionCLIResponse(answer.Choice, answer.Comment))
}

func parseDecisionAskArgs(args []string) (core.DecisionAskRequest, decisionAskOptions, error) {
	req := core.DecisionAskRequest{TimeoutMins: 30}
	var opts decisionAskOptions
	var positional []string
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
			req.Choices = splitDecisionChoices(args[i])
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
				return req, opts, fmt.Errorf("invalid --timeout-mins: %s", args[i])
			}
			req.TimeoutMins = n
		case "--wait":
			opts.wait = true
		case "--data-dir":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--data-dir requires a value")
			}
			i++
			opts.dataDir = args[i]
		case "--config":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--config requires a value")
			}
			i++
			opts.configPath = args[i]
		case "--help", "-h":
			return req, opts, errDecisionUsage
		default:
			positional = append(positional, args[i])
		}
	}
	if req.Message == "" && len(positional) > 0 {
		req.Message = strings.Join(positional, " ")
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

func splitDecisionChoices(raw string) []string {
	var choices []string
	for _, part := range strings.Split(raw, ",") {
		if choice := strings.TrimSpace(part); choice != "" {
			choices = append(choices, choice)
		}
	}
	return choices
}

func waitForDecisionResponse(sockPath, id string, timeout time.Duration) (core.DecisionResponse, error) {
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}
	deadline := time.Now().Add(timeout)
	for {
		resp, err := apiGet(sockPath, "/decision/get?id="+url.QueryEscape(id))
		if err != nil {
			return core.DecisionResponse{}, err
		}
		body, _ := io.ReadAll(resp.Body)
		closeDecisionResponseBody(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return core.DecisionResponse{}, errors.New(strings.TrimSpace(string(body)))
		}
		var record core.DecisionRecord
		if err := json.Unmarshal(body, &record); err != nil {
			return core.DecisionResponse{}, err
		}
		if record.Response != nil {
			return *record.Response, nil
		}
		if time.Now().After(deadline) {
			return core.DecisionResponse{}, fmt.Errorf("decision timed out")
		}
		time.Sleep(time.Second)
	}
}

func formatDecisionCLIResponse(choice, comment string) string {
	var b bytes.Buffer
	fmt.Fprintf(&b, "choice=%s\n", strings.TrimSpace(choice))
	fmt.Fprintf(&b, "comment=%s\n", strings.TrimSpace(comment))
	return b.String()
}

func closeDecisionResponseBody(body io.Closer) {
	if err := body.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: close response body: %v\n", err)
	}
}

func printDecisionUsage() {
	fmt.Println(`Usage:
  cc-connect decision ask --title <text> --message <text> --choices continue,abort,revise [--config path | --data-dir dir] [--wait]`)
}

func printDecisionAskUsage() {
	fmt.Println(`Usage:
  cc-connect decision ask --title <text> --message <text> --choices continue,abort,revise [options]

Options:
  --recommended <choice>   Mark one choice as recommended
  --timeout-mins <n>       Wait timeout in minutes (default 30)
  --wait                   Wait and print choice/comment
  --config <path>          Path to config.toml
  --data-dir <dir>         cc-connect data directory`)
}
