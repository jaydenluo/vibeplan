#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_root"

is_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  echo "Stopping existing process(es) on port $port: $pids"
  while read -r pid; do
    [[ -z "$pid" ]] || kill "$pid" 2>/dev/null || true
  done <<< "$pids"

  for _ in {1..20}; do
    is_listening "$port" || return 0
    sleep 0.25
  done

  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Force stopping process(es) still holding port $port: $pids"
    while read -r pid; do
      [[ -z "$pid" ]] || kill -9 "$pid" 2>/dev/null || true
    done <<< "$pids"
  fi
}

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm is required. Install Node.js 22 and enable pnpm with: corepack enable"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing workspace dependencies..."
  pnpm install --frozen-lockfile
fi

proxy_target=""
if [[ -f apps/web/.env.local ]]; then
  proxy_target="$(sed -n 's/^VITE_API_PROXY_TARGET=//p' apps/web/.env.local | head -1)"
fi

is_remote_proxy_target() {
  local host
  host="$(node -e 'try { console.log(new URL(process.argv[1]).hostname) } catch { process.exit(1) }' "$1" 2>/dev/null || true)"
  [[ -n "$host" && "$host" != "localhost" && "$host" != "127.0.0.1" && "$host" != "::1" ]]
}

stop_port 5173

if [[ "$proxy_target" =~ ^https?:// ]] && is_remote_proxy_target "$proxy_target"; then
  echo "Starting local Web with the configured remote Vibe Plan API proxy..."
  echo "  Web: http://localhost:5173"
  echo "  Data API: $proxy_target"
  exec pnpm --filter @vibeplan/web dev
fi

stop_port 4000

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Update it if you use a non-default local database."
fi

if [[ ! -e apps/api/.env ]]; then
  ln -s ../../.env apps/api/.env
fi

set -a
# shellcheck disable=SC1091
source ./.env
set +a
database_port="$(node -e 'const url = new URL(process.env.DATABASE_URL); console.log(url.port || "5432")')"

if ! is_listening "$database_port" && command -v docker >/dev/null 2>&1; then
  echo "Starting the local PostgreSQL service..."
  docker compose up -d db
  echo "Waiting for PostgreSQL on port $database_port..."
  for _ in {1..30}; do
    if docker compose exec -T db pg_isready -U "${POSTGRES_USER:-vibe}" -d "${POSTGRES_DB:-vibe_plan}" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
elif is_listening "$database_port"; then
  echo "Using the configured PostgreSQL service on port $database_port."
fi

echo "Running database migrations..."
if ! pnpm --filter @vibeplan/api db:migrate; then
  echo "WARNING: database migration failed; continuing to start Web and API."
  echo "Check DATABASE_URL and PostgreSQL credentials if API requests return 500."
fi

echo "Starting Vibe Plan development services..."
echo "  Web: http://localhost:5173"
echo "  API: http://localhost:4000/health"
echo "Press Ctrl+C to stop the services started by this script."

exec pnpm dev
