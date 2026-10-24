#!/usr/bin/env bash

set -euo pipefail

REGISTRY="${REGISTRY:-ccr.ccs.tencentyun.com}"
TENCENT_CCR_NAMESPACE="${TENCENT_CCR_NAMESPACE:-jayden}"
IMAGE_PLATFORMS="${IMAGE_PLATFORMS:-linux/amd64}"

usage() {
  cat <<'EOF'
Usage: scripts/build-and-push-tencent.sh <X.Y.Z> [--publish-npm]

Builds and pushes the Vibe Plan API and Web images with both the release
version and latest tags. Credentials are read from
scripts/tencent-credentials.env or TENCENT_CREDENTIALS_FILE.

Example:
  scripts/build-and-push-tencent.sh 0.1.0
  scripts/build-and-push-tencent.sh 0.1.0 --publish-npm
EOF
}

is_semver() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

read_credential_value() {
  local name="$1"
  awk -v name="$name" 'index($0, name "=") == 1 { value = substr($0, length(name) + 2); sub(/\r$/, "", value); print value; exit }' "$credentials_file"
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name must be set." >&2
    exit 1
  fi
}

if [[ $# -lt 1 || $# -gt 2 ]] || ! is_semver "$1"; then
  usage >&2
  exit 1
fi

IMAGE_VERSION="$1"
publish_npm=false
if [[ "${2:-}" == "--publish-npm" ]]; then
  publish_npm=true
elif [[ $# -eq 2 ]]; then
  usage >&2
  exit 1
fi
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
credentials_file="${TENCENT_CREDENTIALS_FILE:-$root_dir/scripts/tencent-credentials.env}"
if [[ ! -f "$credentials_file" ]]; then
  echo "ERROR: missing $credentials_file. Copy scripts/tencent-credentials.env.example and configure it first." >&2
  exit 1
fi

TENCENT_CCR_USERNAME="${TENCENT_CCR_USERNAME:-$(read_credential_value TENCENT_CCR_USERNAME)}"
TENCENT_CCR_PASSWORD="${TENCENT_CCR_PASSWORD:-$(read_credential_value TENCENT_CCR_PASSWORD)}"
require_var TENCENT_CCR_USERNAME
require_var TENCENT_CCR_PASSWORD

image_ref() { printf '%s/%s/%s:%s' "$REGISTRY" "$TENCENT_CCR_NAMESPACE" "$1" "$IMAGE_VERSION"; }
latest_ref() { printf '%s/%s/%s:latest' "$REGISTRY" "$TENCENT_CCR_NAMESPACE" "$1"; }
BUILD_COMMIT="${BUILD_COMMIT:-$(git -C "$root_dir" rev-parse HEAD)}"

printf '%s' "$TENCENT_CCR_PASSWORD" | docker login "$REGISTRY" --username "$TENCENT_CCR_USERNAME" --password-stdin

docker build --platform "$IMAGE_PLATFORMS" --file "$root_dir/docker/api.Dockerfile" \
  --build-arg "APP_VERSION=$IMAGE_VERSION" --build-arg "BUILD_COMMIT=$BUILD_COMMIT" \
  --tag "$(image_ref vibe-plan-api)" --tag "$(latest_ref vibe-plan-api)" "$root_dir"
docker push "$(image_ref vibe-plan-api)"
docker push "$(latest_ref vibe-plan-api)"

docker build --platform "$IMAGE_PLATFORMS" --file "$root_dir/docker/web.Dockerfile" \
  --build-arg "VITE_APP_VERSION=$IMAGE_VERSION" --build-arg "VITE_BUILD_COMMIT=$BUILD_COMMIT" --build-arg "VITE_API_URL=/api" \
  --tag "$(image_ref vibe-plan-web)" --tag "$(latest_ref vibe-plan-web)" "$root_dir"
docker push "$(image_ref vibe-plan-web)"
docker push "$(latest_ref vibe-plan-web)"

if [[ "$publish_npm" == "true" ]]; then
  "$root_dir/scripts/publish-npm.sh" "$IMAGE_VERSION"
fi

echo "Pushed Vibe Plan images with version $IMAGE_VERSION and latest tags."
echo "API: $(image_ref vibe-plan-api)"
echo "Web: $(image_ref vibe-plan-web)"
