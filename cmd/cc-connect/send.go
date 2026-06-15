package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/chenhg5/cc-connect/core"
)

func runSend(args []string) {
	req, opts, err := parseSendArgs(args)
	if err != nil {
		if errors.Is(err, errSendUsage) {
			printSendUsage()
			return
		}
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		printSendUsage()
		os.Exit(1)
	}

	sockPath := resolveSocketPathFromOptions(socketPathOptions{DataDir: opts.DataDir, ConfigPath: opts.ConfigPath})
	if _, err := os.Stat(sockPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Error: cc-connect is not running (socket not found: %s)\n", sockPath)
		os.Exit(1)
	}

	payload, err := buildSendPayload(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to encode send payload: %v\n", err)
		os.Exit(1)
	}

	token := loadLocalAPIToken(localAPIOptions{DataDir: opts.DataDir, ConfigPath: opts.ConfigPath})
	client := localAPIClient(sockPath, token)

	httpReq, err := http.NewRequest(http.MethodPost, "http://unix/send", bytes.NewReader(payload))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: build request: %v\n", err)
		os.Exit(1)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(httpReq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to connect: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "Error: %s\n", strings.TrimSpace(string(body)))
		os.Exit(1)
	}

	fmt.Println("Message sent successfully.")
}

var errSendUsage = errors.New("show send usage")

type sendCLIOptions struct {
	DataDir    string
	ConfigPath string
}

func parseSendArgs(args []string) (core.SendRequest, sendCLIOptions, error) {
	var req core.SendRequest
	var opts sendCLIOptions
	var useStdin bool
	var imagePaths []string
	var filePaths []string
	var audioPaths []string
	var videoPaths []string
	var positional []string

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--project", "-p":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--project requires a value")
			}
			i++
			req.Project = args[i]
		case "--session", "-s":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--session requires a value")
			}
			i++
			req.SessionKey = args[i]
		case "--message", "-m":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--message requires a value")
			}
			i++
			req.Message = args[i]
		case "--image":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--image requires a path")
			}
			i++
			imagePaths = append(imagePaths, args[i])
		case "--file":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--file requires a path")
			}
			i++
			filePaths = append(filePaths, args[i])
		case "--audio":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--audio requires a path")
			}
			i++
			audioPaths = append(audioPaths, args[i])
		case "--video":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--video requires a path")
			}
			i++
			videoPaths = append(videoPaths, args[i])
		case "--stdin":
			useStdin = true
		case "--at-users":
			if i+1 >= len(args) {
				return req, opts, fmt.Errorf("--at-users requires a value")
			}
			i++
			for _, uid := range strings.Split(args[i], ",") {
				uid = strings.TrimSpace(uid)
				if uid != "" {
					req.AtUsers = append(req.AtUsers, uid)
				}
			}
		case "--at-all":
			req.AtAll = true
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
			return req, opts, errSendUsage
		default:
			positional = append(positional, args[i])
		}
	}

	if useStdin {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return req, opts, fmt.Errorf("reading stdin: %w", err)
		}
		req.Message = strings.TrimSpace(string(data))
	}
	if req.Project == "" {
		req.Project = strings.TrimSpace(os.Getenv("CC_PROJECT"))
	}
	if req.SessionKey == "" {
		req.SessionKey = strings.TrimSpace(os.Getenv("CC_SESSION_KEY"))
	}
	if req.Message == "" {
		req.Message = strings.Join(positional, " ")
	}

	images, err := loadImageAttachments(imagePaths)
	if err != nil {
		return req, opts, err
	}
	files, err := loadFileAttachments(filePaths)
	if err != nil {
		return req, opts, err
	}
	audioFiles, err := loadTypedFileAttachments(audioPaths, "audio")
	if err != nil {
		return req, opts, err
	}
	videoFiles, err := loadTypedFileAttachments(videoPaths, "video")
	if err != nil {
		return req, opts, err
	}
	req.Images = images
	req.Files = append(files, audioFiles...)
	req.Files = append(req.Files, videoFiles...)

	if req.Message == "" && len(req.Images) == 0 && len(req.Files) == 0 {
		return req, opts, fmt.Errorf("message or attachment is required")
	}

	return req, opts, nil
}

func loadImageAttachments(paths []string) ([]core.ImageAttachment, error) {
	images := make([]core.ImageAttachment, 0, len(paths))
	for _, path := range paths {
		data, fileName, mimeType, err := readAttachment(path)
		if err != nil {
			return nil, err
		}
		if !strings.HasPrefix(mimeType, "image/") {
			return nil, fmt.Errorf("%s is not an image (detected mime: %s)", path, mimeType)
		}
		images = append(images, core.ImageAttachment{MimeType: mimeType, Data: data, FileName: fileName})
	}
	return images, nil
}

func loadFileAttachments(paths []string) ([]core.FileAttachment, error) {
	files := make([]core.FileAttachment, 0, len(paths))
	for _, path := range paths {
		data, fileName, mimeType, err := readAttachment(path)
		if err != nil {
			return nil, err
		}
		files = append(files, core.FileAttachment{MimeType: mimeType, Data: data, FileName: fileName})
	}
	return files, nil
}

func loadTypedFileAttachments(paths []string, mediaType string) ([]core.FileAttachment, error) {
	files := make([]core.FileAttachment, 0, len(paths))
	for _, path := range paths {
		data, fileName, mimeType, err := readAttachment(path)
		if err != nil {
			return nil, err
		}
		if !attachmentMatchesMediaType(mimeType, fileName, mediaType) {
			return nil, fmt.Errorf("%s is not %s media (detected mime: %s)", path, mediaType, mimeType)
		}
		files = append(files, core.FileAttachment{MimeType: mimeType, Data: data, FileName: fileName})
	}
	return files, nil
}

func attachmentMatchesMediaType(mimeType, fileName, mediaType string) bool {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch mediaType {
	case "audio":
		if strings.HasPrefix(mimeType, "audio/") {
			return true
		}
		switch ext {
		case ".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav":
			return true
		}
	case "video":
		if strings.HasPrefix(mimeType, "video/") {
			return true
		}
		switch ext {
		case ".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm":
			return true
		}
	}
	return false
}

const maxAttachmentSize = 50 << 20 // 50 MB

func readAttachment(path string) ([]byte, string, string, error) {
	cleaned := filepath.Clean(path)

	info, err := os.Stat(cleaned)
	if err != nil {
		return nil, "", "", fmt.Errorf("read attachment %s: %w", path, err)
	}
	if info.Size() > maxAttachmentSize {
		return nil, "", "", fmt.Errorf("attachment %s exceeds size limit (%d MB)", path, maxAttachmentSize>>20)
	}

	data, err := os.ReadFile(cleaned)
	if err != nil {
		return nil, "", "", fmt.Errorf("read attachment %s: %w", path, err)
	}
	fileName := filepath.Base(cleaned)
	return data, fileName, detectAttachmentMimeType(fileName, data), nil
}

func detectAttachmentMimeType(fileName string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".md", ".markdown":
		return "text/markdown; charset=utf-8"
	}
	if byExt := mime.TypeByExtension(ext); byExt != "" {
		return byExt
	}
	if len(data) == 0 {
		return "application/octet-stream"
	}
	sniff := data
	if len(sniff) > 512 {
		sniff = sniff[:512]
	}
	return http.DetectContentType(sniff)
}

func buildSendPayload(req core.SendRequest) ([]byte, error) {
	return json.Marshal(req)
}

func decodeSendPayload(data []byte, req *core.SendRequest) error {
	return json.Unmarshal(data, req)
}

type socketPathOptions struct {
	DataDir    string
	ConfigPath string
}

func resolveSocketPath(dataDir string) string {
	return resolveSocketPathFromOptions(socketPathOptions{DataDir: dataDir})
}

func resolveSocketPathFromOptions(opts socketPathOptions) string {
	if opts.DataDir == "" && opts.ConfigPath != "" {
		if dataDir := readConfigDataDir(opts.ConfigPath); dataDir != "" {
			opts.DataDir = dataDir
		}
	}
	if opts.DataDir == "" {
		if envDataDir := strings.TrimSpace(os.Getenv("CC_DATA_DIR")); envDataDir != "" {
			opts.DataDir = envDataDir
		}
	}
	if opts.DataDir == "" {
		if dataDir := resolveDataDirFromRunningConfig(); dataDir != "" {
			opts.DataDir = dataDir
		}
	}
	if opts.DataDir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			opts.DataDir = filepath.Join(home, ".cc-connect")
		} else {
			opts.DataDir = ".cc-connect"
		}
	}
	return filepath.Join(opts.DataDir, "run", "api.sock")
}

func resolveDataDirFromRunningConfig() string {
	for _, configPath := range runningConfigCandidates() {
		lockPath := filepath.Join(filepath.Dir(configPath), "."+filepath.Base(configPath)+".lock")
		data, err := os.ReadFile(lockPath)
		if err != nil {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
		if err != nil || pid <= 0 {
			continue
		}
		if dataDir := readConfigDataDir(configPath); dataDir != "" {
			return dataDir
		}
	}
	return ""
}

func readConfigDataDir(configPath string) string {
	var cfg struct {
		DataDir string `toml:"data_dir"`
	}
	if _, err := toml.DecodeFile(configPath, &cfg); err != nil {
		return ""
	}
	return strings.TrimSpace(os.ExpandEnv(cfg.DataDir))
}

func runningConfigCandidates() []string {
	var out []string
	if env := strings.TrimSpace(os.Getenv("CC_CONNECT_CONFIG")); env != "" {
		out = append(out, env)
	}
	if env := strings.TrimSpace(os.Getenv("CC_CONFIG")); env != "" {
		out = append(out, env)
	}
	if env := strings.TrimSpace(os.Getenv("CC_CONNECT_SERVICE_DIRS")); env != "" {
		for _, part := range strings.Split(env, string(os.PathListSeparator)) {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			out = append(out, filepath.Join(part, "config.toml"))
		}
	}
	if exe, err := os.Executable(); err == nil {
		out = append(out, filepath.Join(filepath.Dir(exe), "config.toml"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		out = append(out, filepath.Join(home, ".cc-connect", "config.toml"))
	}
	out = append(out, "config.toml")
	return out
}

func printSendUsage() {
	fmt.Println(`Usage: cc-connect send [options] <message>
       cc-connect send [options] -m <message>
       cc-connect send [options] --stdin < file
       cc-connect send [options] --image <path>
       cc-connect send [options] --file <path>
       cc-connect send [options] --audio <path>
       cc-connect send [options] --video <path>
       echo "msg" | cc-connect send [options] --stdin

Send a message or attachment to an active cc-connect session.

Options:
  -m, --message <text>     Message to send (preferred over positional args)
      --image <path>       Send an image attachment (repeatable)
      --file <path>        Send a file attachment (repeatable)
      --audio <path>       Send an audio attachment (repeatable)
      --video <path>       Send a video attachment (repeatable)
      --stdin              Read message from stdin (best for long/special-char messages)
      --at-users <ids>     @ user IDs, comma-separated (DingTalk)
      --at-all             @ everyone (DingTalk)
  -p, --project <name>     Target project (optional if only one project)
  -s, --session <key>      Target session key (optional, picks first active)
      --data-dir <path>    Data directory (default: ~/.cc-connect)
  -h, --help               Show this help

Examples:
  cc-connect send "Daily summary: ..."
  cc-connect send -m "Build completed successfully"
  cc-connect send --message "Chart generated" --image /tmp/chart.png
  cc-connect send --file /tmp/report.pdf
  cc-connect send --video /tmp/demo.mp4
  cc-connect send --audio /tmp/voice.opus
  cc-connect send --stdin <<'EOF'
    Long message with "special" chars, $variables, and newlines
  EOF`)
}
