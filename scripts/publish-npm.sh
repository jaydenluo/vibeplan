#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/publish-npm.sh [X.Y.Z] [--login] [--otp <code>] [--registry <url>]

Builds and publishes @vibeplan/templates first, then @vibeplan/cli. npm login or a
configured npm token is required before running this command. If NPM_TOKEN is
set, it is used through a temporary npm user config and removed on exit.

Use --login to run npm's interactive username/password login before publishing.
Use --otp or NPM_OTP to provide the one-time password required by npm 2FA.

When the version is omitted, the patch component is incremented from the
matching versions in both package.json files. An explicit version synchronizes
both packages to that version.
EOF
}

is_semver() { [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }

if [[ $# -eq 1 && ( "$1" == "-h" || "$1" == "--help" ) ]]; then
  usage
  exit 0
fi
version=""
if [[ $# -gt 0 && "$1" != -* ]]; then
  version="$1"
  shift
  if ! is_semver "$version"; then
    echo "ERROR: release version must use X.Y.Z: $version" >&2
    exit 1
  fi
fi

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root_dir"
credentials_file="${NPM_CREDENTIALS_FILE:-$root_dir/scripts/tencent-credentials.env}"
read_credential_value() {
  local name="$1"
  awk -v name="$name" '
    index($0, name "=") == 1 { value = substr($0, length(name) + 2); sub(/\r$/, "", value); print value; exit }
    index($0, name ":") == 1 { value = substr($0, length(name) + 2); sub(/\r$/, "", value); print value; exit }
  ' "$credentials_file"
}

if [[ -f "$credentials_file" ]]; then
  NPM_TOKEN="${NPM_TOKEN:-$(read_credential_value NPM_TOKEN)}"
  NPM_REGISTRY="${NPM_REGISTRY:-$(read_credential_value NPM_REGISTRY)}"
fi

npm_registry="${NPM_REGISTRY:-}"
login_requested=false
otp="${NPM_OTP:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --login)
      login_requested=true
      shift
      ;;
    --otp)
      [[ $# -ge 2 ]] || { echo "ERROR: --otp requires a code." >&2; exit 1; }
      otp="$2"
      shift 2
      ;;
    --registry)
      [[ $# -ge 2 ]] || { echo "ERROR: --registry requires a URL." >&2; exit 1; }
      npm_registry="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$login_requested" == true && -n "${NPM_TOKEN:-}" ]]; then
  echo "ERROR: do not combine --login with NPM_TOKEN; choose one authentication method." >&2
  exit 1
fi

if [[ "$login_requested" == false && -z "${NPM_TOKEN:-}" ]]; then
  echo "ERROR: npm token is not configured." >&2
  echo "Copy scripts/tencent-credentials.env.example to scripts/tencent-credentials.env and set NPM_TOKEN." >&2
  echo "For interactive login, run this command again with --login." >&2
  exit 1
fi

if [[ "$login_requested" == true ]]; then
  login_args=(--auth-type=legacy)
  if [[ -n "$npm_registry" ]]; then
    login_args+=(--registry "$npm_registry")
  fi
  echo "Starting interactive npm login. Your password is handled by npm and is not stored by this script."
  npm login "${login_args[@]}"
fi

# Keep token-based authentication out of the repository and the user's
# permanent npm configuration.
temporary_npm_config=""
cleanup_npm_config() {
  if [[ -n "$temporary_npm_config" ]]; then
    rm -f -- "$temporary_npm_config"
  fi
}
trap cleanup_npm_config EXIT

if [[ -n "${NPM_TOKEN:-}" ]]; then
  if [[ -z "$npm_registry" ]]; then
    npm_registry="https://registry.npmjs.org"
  fi

  registry_host="${npm_registry#http://}"
  registry_host="${registry_host#https://}"
  registry_host="${registry_host%/}"
  temporary_npm_config=$(mktemp "${TMPDIR:-/tmp}/vibe-plan-npmrc.XXXXXX")
  chmod 600 "$temporary_npm_config"
  {
    printf 'registry=%s\n' "$npm_registry"
    printf '//%s/:_authToken=%s\n' "$registry_host" "$NPM_TOKEN"
  } > "$temporary_npm_config"
  export NPM_CONFIG_USERCONFIG="$temporary_npm_config"

  if ! npm_account=$(npm whoami --registry "$npm_registry" 2>/dev/null); then
    echo "ERROR: NPM_TOKEN was rejected by $npm_registry. It may be expired, revoked, or invalid." >&2
    echo "Generate a new Granular Access Token and update $credentials_file." >&2
    exit 1
  fi
  echo "Verified npm token for $npm_account."
fi

# Select and persist the release version only after npm authentication succeeds.
version=$(node - "$version" <<'NODE'
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
echo "Preparing @vibeplan/templates@$version and @vibeplan/cli@$version."

run_release_step() {
  if "$@"; then return 0; fi
  echo "ERROR: release preparation failed. Version $version is recorded in both package.json files; retry with: scripts/publish-npm.sh $version" >&2
  exit 1
}

run_release_step pnpm build
run_release_step bash "$root_dir/scripts/verify-npm-package.sh" "$version"

publish_args=(--access public --no-git-checks)
if [[ -n "$npm_registry" ]]; then
  publish_args+=(--registry "$npm_registry")
fi
if [[ -n "$otp" ]]; then
  publish_args+=(--otp "$otp")
fi

if ! pnpm --filter @vibeplan/templates publish "${publish_args[@]}"; then
  echo "ERROR: @vibeplan/templates publish failed." >&2
  echo "If npm returned 404 on PUT, the @vibeplan npm scope is missing or your account is not a member of that organization." >&2
  echo "Create/join the @vibeplan organization and grant this token package access." >&2
  echo "For 403/EOTP errors, ensure the token has package Read and write permission and Bypass 2FA enabled." >&2
  exit 1
fi
if ! pnpm --filter @vibeplan/cli publish "${publish_args[@]}"; then
  echo "ERROR: @vibeplan/cli publish failed. Check the @vibeplan scope membership and token package permissions." >&2
  exit 1
fi
echo "Published @vibeplan/templates@$version and @vibeplan/cli@$version."
