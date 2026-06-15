//go:build windows

package core

import "os"

func applySocketPermissions(sockPath string) error {
	return os.Chmod(sockPath, 0o666)
}
