#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_dir="${CC_CONNECT_RUNTIME_DIR:-$HOME/.cc-connect-docker}"

mkdir -p "$runtime_dir/config" "$runtime_dir/data"

target="$runtime_dir/config/config.toml"
if [[ -e "$target" ]]; then
  echo "Runtime config already exists: $target"
  echo "Not overwriting it."
else
  cp "$repo_root/deploy/cc-connect-docker/config.template.toml" "$target"
  chmod 600 "$target"
  echo "Created runtime config: $target"
  echo "Edit app_id and app_secret before starting the container."
fi

cat > "$runtime_dir/.env" <<EOF
CC_CONNECT_RUNTIME_DIR=$runtime_dir
CC_CONNECT_CODEX_HOME=/mnt/c/Users/Administrator/.codex
CC_CONNECT_WORKSPACE=/mnt/f/development/cc-connect-fork
EOF

echo "Wrote compose env: $runtime_dir/.env"
