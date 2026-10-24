#!/usr/bin/env bash

set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$root_dir"
data_dir="$root_dir/data/postgres"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: ./deploy.sh [version|latest]

Without an argument, uses VIBE_PLAN_VERSION from .env. Passing latest or a
specific version temporarily overrides .env, pulls those images, and restarts
the stack. For example, ./deploy.sh latest or ./deploy.sh 0.1.0.
EOF
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy .env.example to .env and configure it first." >&2
  exit 1
fi

# PostgreSQL is stored inside this deployment directory. On the first run
# after upgrading from the old named volume, copy that volume before startup.
mkdir -p "$data_dir"
if [[ -z "$(find "$data_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  old_volume="$(docker volume ls -q --filter label=com.docker.compose.volume=vibe-plan-postgres | head -n 1)"
  if [[ -n "$old_volume" ]]; then
    echo "Migrating PostgreSQL data from Docker volume $old_volume to $data_dir"
    docker compose down
    docker run --rm \
      -v "$old_volume:/from:ro" \
      -v "$data_dir:/to" \
      postgres:16-alpine \
      sh -c 'cp -a /from/. /to/'
    echo "PostgreSQL data migration completed. The old volume was retained as a backup."
  fi
fi

traefik_network="$(awk -F= '$1 == "TRAEFIK_NETWORK" { print $2; exit }' .env | tr -d '\r' | xargs)"
traefik_network="${traefik_network:-traefik-public}"
if ! docker network inspect "$traefik_network" >/dev/null 2>&1; then
  echo "Creating external Docker network: $traefik_network"
  docker network create "$traefik_network" >/dev/null
fi

if [[ $# -gt 1 ]]; then
  echo "ERROR: expected at most one image version argument." >&2
  exit 1
fi
if [[ $# -eq 1 ]]; then
  export VIBE_PLAN_VERSION="$1"
fi

docker compose pull
docker compose up -d --remove-orphans
docker compose ps
echo "Vibe Plan deployment is running."
