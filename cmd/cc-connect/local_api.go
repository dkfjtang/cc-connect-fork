package main

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
)

type localAPIOptions struct {
	ConfigPath string
	DataDir    string
	Token      string
}

func loadLocalAPIToken(opts localAPIOptions) string {
	if tok := strings.TrimSpace(opts.Token); tok != "" {
		return tok
	}
	if tok := strings.TrimSpace(os.Getenv("CC_CONNECT_LOCAL_API_TOKEN")); tok != "" {
		return tok
	}
	if opts.ConfigPath != "" {
		if tok := readLocalAPITokenFromConfig(opts.ConfigPath); tok != "" {
			return tok
		}
	}
	if dataDir := strings.TrimSpace(opts.DataDir); dataDir != "" {
		if tok := readLocalAPITokenFromRunningConfig(dataDir); tok != "" {
			return tok
		}
	}
	return ""
}

func readLocalAPITokenFromConfig(configPath string) string {
	var cfg struct {
		LocalAPI struct {
			Token string `toml:"token"`
		} `toml:"local_api"`
	}
	if _, err := toml.DecodeFile(configPath, &cfg); err != nil {
		return ""
	}
	return strings.TrimSpace(os.ExpandEnv(cfg.LocalAPI.Token))
}

func readLocalAPITokenFromRunningConfig(dataDir string) string {
	for _, configPath := range runningConfigCandidates() {
		lockPath := filepath.Join(filepath.Dir(configPath), "."+filepath.Base(configPath)+".lock")
		data, err := os.ReadFile(lockPath)
		if err != nil || len(data) == 0 {
			continue
		}
		if strings.TrimSpace(dataDir) != "" {
			if resolved := readConfigDataDir(configPath); resolved != "" && !strings.EqualFold(strings.TrimSpace(resolved), strings.TrimSpace(dataDir)) {
				continue
			}
		}
		if tok := readLocalAPITokenFromConfig(configPath); tok != "" {
			return tok
		}
	}
	return ""
}

func localAPIClient(sockPath, token string) *http.Client {
	base := &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return net.Dial("unix", sockPath)
		},
	}
	return &http.Client{Transport: localAPIAuthTransport{base: base, token: token}}
}

func attachLocalAPIAuth(req *http.Request, token string) {
	token = strings.TrimSpace(token)
	if token == "" {
		return
	}
	req.Header.Set("X-CC-Connect-Token", token)
	req.Header.Set("Authorization", "Bearer "+token)
}

type localAPIAuthTransport struct {
	base  http.RoundTripper
	token string
}

func (t localAPIAuthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.base == nil {
		t.base = http.DefaultTransport
	}
	if strings.TrimSpace(t.token) == "" {
		return t.base.RoundTrip(req)
	}
	cloned := req.Clone(req.Context())
	attachLocalAPIAuth(cloned, t.token)
	return t.base.RoundTrip(cloned)
}
