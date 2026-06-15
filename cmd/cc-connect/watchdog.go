package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type watchdogCheckpointOptions struct {
	DataDir       string
	Wait          bool
	Skip          bool
	ElapsedMins   int
	ThresholdMins int
}

type watchdogCheckpointResult struct {
	DecisionID string
	Response   *core.DecisionResponse
	Deduped    string
}

var errWatchdogUsage = errors.New("show watchdog usage")

func runWatchdog(args []string) {
	if len(args) == 0 {
		printWatchdogUsage()
		return
	}
	switch args[0] {
	case "checkpoint":
		runWatchdogCheckpoint(args[1:])
	case "--help", "-h":
		printWatchdogUsage()
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown watchdog subcommand %q\n", args[0])
		printWatchdogUsage()
		os.Exit(1)
	}
}

func runWatchdogCheckpoint(args []string) {
	req, opts, err := parseWatchdogCheckpointArgs(args)
	if err != nil {
		if errors.Is(err, errWatchdogUsage) {
			printWatchdogUsage()
			return
		}
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		printWatchdogUsage()
		os.Exit(1)
	}
	if opts.Skip {
		fmt.Printf("watchdog=skipped\nelapsed_mins=%d\nthreshold_mins=%d\n", opts.ElapsedMins, opts.ThresholdMins)
		return
	}

	sockPath := resolveSocketPath(opts.DataDir)
	if _, err := os.Stat(sockPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Error: cc-connect is not running (socket not found: %s)\n", sockPath)
		os.Exit(1)
	}
	client := decisionHTTPClient(sockPath)
	result, err := runWatchdogCheckpointWithClient(context.Background(), client, "http://unix", req, opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	if result.Response == nil {
		if result.Deduped != "" {
			fmt.Print(result.Deduped)
			return
		}
		fmt.Printf("decision_id=%s\n", result.DecisionID)
		return
	}
	fmt.Print(formatDecisionCLIResponse(result.Response.Choice, result.Response.Comment))
}

func parseWatchdogCheckpointArgs(args []string) (core.DecisionAskRequest, watchdogCheckpointOptions, error) {
	var task, summary, choices string
	req := core.DecisionAskRequest{
		Choices:     []string{"continue", "pause", "revise"},
		Recommended: "continue",
		TimeoutMins: 30,
	}
	opts := watchdogCheckpointOptions{ThresholdMins: 10}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--task":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--task requires a value")
			}
			i++
			task = strings.TrimSpace(args[i])
		case "--summary":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--summary requires a value")
			}
			i++
			summary = strings.TrimSpace(args[i])
		case "--elapsed-mins":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--elapsed-mins requires a value")
			}
			i++
			n, err := strconv.Atoi(args[i])
			if err != nil || n < 0 {
				return req, opts, fmt.Errorf("--elapsed-mins must be a non-negative integer")
			}
			opts.ElapsedMins = n
		case "--threshold-mins":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--threshold-mins requires a value")
			}
			i++
			n, err := strconv.Atoi(args[i])
			if err != nil || n <= 0 {
				return req, opts, fmt.Errorf("--threshold-mins must be a positive integer")
			}
			opts.ThresholdMins = n
		case "--choices":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--choices requires a value")
			}
			i++
			choices = args[i]
		case "--recommended":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--recommended requires a value")
			}
			i++
			req.Recommended = strings.TrimSpace(args[i])
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
		case "--help", "-h":
			return req, opts, errWatchdogUsage
		default:
			return req, opts, fmt.Errorf("unknown argument %q", args[i])
		}
	}
	if task == "" {
		return req, opts, fmt.Errorf("--task is required")
	}
	if summary == "" {
		return req, opts, fmt.Errorf("--summary is required")
	}
	if choices != "" {
		req.Choices = splitDecisionCSV(choices)
	}
	req.Title = "长任务需要确认: " + task
	req.Message = fmt.Sprintf("任务: %s\n已运行: %d 分钟\n当前状态: %s\n\n请选择下一步。", task, opts.ElapsedMins, summary)
	opts.Skip = opts.ElapsedMins < opts.ThresholdMins
	return req, opts, nil
}

func runWatchdogCheckpointWithClient(ctx context.Context, client *http.Client, baseURL string, req core.DecisionAskRequest, opts watchdogCheckpointOptions) (watchdogCheckpointResult, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return watchdogCheckpointResult{}, fmt.Errorf("encode watchdog decision payload: %w", err)
	}
	resp, err := client.Post(strings.TrimRight(baseURL, "/")+"/decision/ask", "application/json", bytes.NewReader(payload))
	if err != nil {
		return watchdogCheckpointResult{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusAlreadyReported {
		return watchdogCheckpointResult{Deduped: formatDecisionDedupedCLIResponse(body)}, nil
	}
	if resp.StatusCode != http.StatusOK {
		return watchdogCheckpointResult{}, fmt.Errorf("%s", strings.TrimSpace(string(body)))
	}
	var dec core.Decision
	if err := json.Unmarshal(body, &dec); err != nil {
		return watchdogCheckpointResult{}, err
	}
	result := watchdogCheckpointResult{DecisionID: dec.ID}
	if !opts.Wait {
		return result, nil
	}
	waitCtx, cancel := context.WithTimeout(ctx, time.Duration(req.TimeoutMins)*time.Minute+5*time.Second)
	defer cancel()
	decisionResp, err := waitForDecisionAt(waitCtx, client, baseURL, dec.ID, time.Second)
	if err != nil {
		return watchdogCheckpointResult{}, err
	}
	result.Response = &decisionResp
	return result, nil
}

func printWatchdogUsage() {
	fmt.Println(`Usage:
  cc-connect watchdog checkpoint --task <name> --summary <text> --elapsed-mins <n> [--threshold-mins 10] [--event-key key --event-fingerprint fp --cooldown-mins 30] [--wait]

Examples:
  cc-connect watchdog checkpoint --task "生产发布复核" --summary "测试已运行 12 分钟，仍有 1 个失败用例" --elapsed-mins 12 --wait`)
}
