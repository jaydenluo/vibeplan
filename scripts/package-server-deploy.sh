#!/usr/bin/env bash

set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
version="${1:-$(date +%Y%m%d%H%M%S)}"
output="${2:-$root_dir/vibe-plan-server-${version}.tar.gz}"

if [[ ! -d "$root_dir/deploy/server" ]]; then
  echo "ERROR: deploy/server directory not found." >&2
  exit 1
fi

tar \
  --exclude='server/.env' \
  --exclude='server/data/postgres' \
  -czf "$output" \
  -C "$root_dir/deploy" \
  server
echo "Created $output"
