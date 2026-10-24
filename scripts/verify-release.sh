#!/usr/bin/env bash
set -euo pipefail
# Read-only post-release checks; intentionally requires an explicit deployment URL.
if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo 'Usage: scripts/verify-release.sh <X.Y.Z> <api-base-url> [npm-registry-url]' >&2
  exit 1
fi
release_version="$1"
api_base="${2%/}"
registry="${3:-https://registry.npmjs.org}"
[[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected X.Y.Z release version' >&2; exit 1; }
[[ "$api_base" == https://* || "$api_base" == http://localhost:* || "$api_base" == http://127.0.0.1:* ]] || { echo 'Expected HTTPS deployment URL or localhost' >&2; exit 1; }
curl --fail --silent --show-error --max-time 20 "$api_base/health" | node -e '
let raw = ""; process.stdin.on("data", (chunk) => raw += chunk); process.stdin.on("end", () => {
  const health = JSON.parse(raw);
  if (health.status !== "ok") throw new Error("API health failed");
  console.log(JSON.stringify(health));
});'
curl --fail --silent --show-error --max-time 20 "$api_base/version" | node -e '
let raw = ""; process.stdin.on("data", (chunk) => raw += chunk); process.stdin.on("end", () => {
  const metadata = JSON.parse(raw);
  if (metadata.version !== process.argv[1]) throw new Error("API version mismatch");
  if (!metadata.buildCommit) throw new Error("Missing API build commit");
  console.log(JSON.stringify(metadata));
});' "$release_version"
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bash "$root_dir/scripts/verify-npm-package.sh" "$release_version" "$registry"
echo 'Read-only release metadata and registry package checks passed. Business acceptance requires the isolated E2E suite.'
