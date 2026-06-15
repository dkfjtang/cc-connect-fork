package core

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestNewAPIServerSocketPermissions(t *testing.T) {
	api, err := NewAPIServer(apiTestTempDir(t))
	if err != nil {
		t.Fatalf("NewAPIServer error = %v", err)
	}
	defer api.Stop()

	info, err := os.Stat(api.SocketPath())
	if err != nil {
		t.Fatalf("stat socket: %v", err)
	}
	got := info.Mode().Perm()
	want := os.FileMode(0o600)
	if runtime.GOOS == "windows" {
		want = 0o666
	}
	if got != want {
		t.Fatalf("socket permissions = %o, want %o", got, want)
	}
}

func TestNewAPIServerSocketAcceptsLocalClient(t *testing.T) {
	api, err := NewAPIServer(apiTestTempDir(t))
	if err != nil {
		t.Fatalf("NewAPIServer error = %v", err)
	}
	api.Start()
	defer api.Stop()

	client := &http.Client{Transport: &http.Transport{DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
		return net.DialTimeout("unix", filepath.Clean(api.SocketPath()), time.Second)
	}}}
	resp, err := client.Get("http://unix/sessions")
	if err != nil {
		t.Fatalf("GET /sessions over API socket error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /sessions status = %d", resp.StatusCode)
	}
}

func TestAPIServerLocalAPIToken(t *testing.T) {
	api, err := NewAPIServerWithToken(apiTestTempDir(t), "secret-token")
	if err != nil {
		t.Fatalf("NewAPIServerWithToken error = %v", err)
	}
	api.Start()
	defer api.Stop()

	client := apiSocketHTTPClient(api.SocketPath())
	resp, err := client.Get("http://unix/sessions")
	if err != nil {
		t.Fatalf("GET without token error = %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET without token status = %d, want 401", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, "http://unix/sessions", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer secret-token")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("GET with bearer token error = %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET with bearer token status = %d, want 200", resp.StatusCode)
	}

	req, err = http.NewRequest(http.MethodGet, "http://unix/sessions", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("X-CC-Connect-Token", "secret-token")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("GET with header token error = %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET with header token status = %d, want 200", resp.StatusCode)
	}
}

func apiSocketHTTPClient(sockPath string) *http.Client {
	return &http.Client{Transport: &http.Transport{DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
		return net.DialTimeout("unix", filepath.Clean(sockPath), time.Second)
	}}}
}

func apiTestTempDir(t *testing.T) string {
	t.Helper()
	if runtime.GOOS != "windows" {
		return t.TempDir()
	}
	base := `C:\tmp`
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatalf("create short temp base: %v", err)
	}
	dir, err := os.MkdirTemp(base, "cc-api-*")
	if err != nil {
		t.Fatalf("create short temp dir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
	})
	return dir
}
