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
