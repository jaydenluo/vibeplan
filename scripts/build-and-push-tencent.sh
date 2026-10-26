#!/usr/bin/env bash

set -euo pipefail

REGISTRY="${REGISTRY:-ccr.ccs.tencentyun.com}"
TENCENT_CCR_NAMESPACE="${TENCENT_CCR_NAMESPACE:-jayden}"
IMAGE_PLATFORMS="${IMAGE_PLATFORMS:-linux/amd64}"

usage() {
  cat <<'EOF'
Usage: scripts/build-and-push-tencent.sh [X.Y.Z] [--publish-npm]

Builds and pushes the Vibe Plan API and Web images with both the release
version and latest tags. Credentials are read from
scripts/tencent-credentials.env or TENCENT_CREDENTIALS_FILE.

Example:
  scripts/build-and-push-tencent.sh
  scripts/build-and-push-tencent.sh 0.1.0
  scripts/build-and-push-tencent.sh 0.1.0 --publish-npm

When the version is omitted, the patch component is incremented from the
matching versions in both package.json files.
EOF
}

is_semver() { [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }

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

if [[ $# -gt 0 && ( "$1" == "-h" || "$1" == "--help" ) ]]; then
  usage
  exit 0
fi

IMAGE_VERSION=""
if [[ $# -gt 0 && "$1" != -* ]]; then
  IMAGE_VERSION="$1"
  shift
  if ! is_semver "$IMAGE_VERSION"; then
    echo "ERROR: release version must use X.Y.Z: $IMAGE_VERSION" >&2
    exit 1
  fi
fi
publish_npm=false
if [[ "${1:-}" == "--publish-npm" ]]; then
  publish_npm=true
  shift
elif [[ $# -gt 0 ]]; then
  usage >&2
  exit 1
fi
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root_dir"
credentials_file="${TENCENT_CREDENTIALS_FILE:-$root_dir/scripts/tencent-credentials.env}"
if [[ ! -f "$credentials_file" ]]; then
  echo "ERROR: missing $credentials_file. Copy scripts/tencent-credentials.env.example and configure it first." >&2
  exit 1
fi

TENCENT_CCR_USERNAME="${TENCENT_CCR_USERNAME:-$(read_credential_value TENCENT_CCR_USERNAME)}"
TENCENT_CCR_PASSWORD="${TENCENT_CCR_PASSWORD:-$(read_credential_value TENCENT_CCR_PASSWORD)}"
require_var TENCENT_CCR_USERNAME
require_var TENCENT_CCR_PASSWORD

IMAGE_VERSION=$(node - "$IMAGE_VERSION" <<'NODE'
const fs = require('node:fs');
const files = ['packages/templates/package.json', 'apps/cli/package.json'];
const packages = files.map((file) => ({ file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }));
const requested = process.argv[2] || '';
const current = packages.map(({ data }) => data.version);
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (current.some((value) => !semver.test(value))) {
  throw new Error(`package versions must use X.Y.Z: ${current.join(', ')}`);
}
let version = requested;
if (!version) {
  if (current[0] !== current[1]) {
    throw new Error(`package versions must match before automatic increment: ${current.join(', ')}`);
  }
  const [major, minor, patch] = current[0].split('.').map(Number);
  version = `${major}.${minor}.${patch + 1}`;
}
if (!semver.test(version)) throw new Error(`release version must use X.Y.Z: ${version}`);
for (const { file, data } of packages) {
  data.version = version;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
process.stdout.write(version);
NODE
)
echo "Preparing image release $IMAGE_VERSION."

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
