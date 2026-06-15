#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

mkdir -p dist

tags=(
  no_acp
  no_antigravity
  no_claudecode
  no_copilot
  no_cursor
  no_devin
  no_gemini
  no_iflow
  no_kimi
  no_opencode
  no_pi
  no_qoder
  no_tmux
  no_telegram
  no_discord
  no_slack
  no_dingtalk
  no_wecom
  no_weixin
  no_qq
  no_qqbot
  no_line
  no_weibo
  no_max
  no_web
)

commit="${CC_CONNECT_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo none)}"
build_time="${CC_CONNECT_BUILD_TIME:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"

GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  go build \
  -tags "${tags[*]}" \
  -ldflags "-s -w -H windowsgui -X main.version=v1.3.3-beta.4 -X main.commit=${commit} -X main.buildTime=${build_time}" \
  -o dist/cc-connect-v1.3.3-beta.4-windows-amd64.exe \
  ./cmd/cc-connect

ls -lh dist/cc-connect-v1.3.3-beta.4-windows-amd64.exe
