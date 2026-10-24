#!/usr/bin/env bash
set -euo pipefail
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root_dir"
release_version="${1:-$(node -p "require('./apps/cli/package.json').version")}"
registry="${2:-}"
[[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected X.Y.Z release version' >&2; exit 1; }
verification_dir=$(mktemp -d "${TMPDIR:-/tmp}/vibeplan-package-check.XXXXXX")
trap 'rm -rf -- "$verification_dir"' EXIT
mkdir -p "$verification_dir/artifacts" "$verification_dir/install"
if [[ -n "$registry" ]]; then
  # Read-only registry verification. No login, publish, or global installation.
  npm pack "@vibeplan/templates@$release_version" --registry "$registry" --pack-destination "$verification_dir/artifacts"
  npm pack "@vibeplan/cli@$release_version" --registry "$registry" --pack-destination "$verification_dir/artifacts"
else
  pnpm --filter @vibeplan/templates build
  pnpm --filter @vibeplan/cli build
  pnpm --filter @vibeplan/templates pack --pack-destination "$verification_dir/artifacts"
  pnpm --filter @vibeplan/cli pack --pack-destination "$verification_dir/artifacts"
fi
templates_package="$verification_dir/artifacts/vibeplan-templates-$release_version.tgz"
cli_package="$verification_dir/artifacts/vibeplan-cli-$release_version.tgz"
[[ -f "$templates_package" && -f "$cli_package" ]] || { echo 'Release manifests or packed versions do not match' >&2; exit 1; }
if tar -tzf "$templates_package" | grep -q '\.test\.'; then
  echo 'Templates release contains test artifacts' >&2; exit 1
fi
install_args=(--prefix "$verification_dir/install" --no-audit --no-fund)
if [[ -n "$registry" ]]; then install_args+=(--registry "$registry"); fi
npm install "${install_args[@]}" "$templates_package" "$cli_package"
cli="$verification_dir/install/node_modules/.bin/vibeplan"
[[ "$("$cli" --version)" == "$release_version" ]] || { echo 'Packed CLI version mismatch' >&2; exit 1; }
"$cli" --help
"$cli" task:plan --help | grep -q -- '--file'
"$cli" task:progress --help | grep -q -- '--stage'
"$cli" task:report --help | grep -q -- '--file'
"$cli" task:context --help | grep -q -- '<id>'
"$cli" task:update --help | grep -q -- '--task-version'
"$cli" task:report --help | grep -q -- '--git-base'
"$cli" plan:prepare --help | grep -q -- '--check'
"$cli" plan:run --help | grep -q -- '--auto-accept'
"$cli" plan:run --help | grep -q -- '--resume'
"$cli" plan:status --help | grep -q -- '--file'
"$cli" task:log-edit --help | grep -q -- '--log-version'
"$cli" task:log-withdraw --help | grep -q -- '--log-version'
node --input-type=module - "$verification_dir/install" "$release_version" <<'NODE'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const [directory, version] = process.argv.slice(2);
const templatePath = `${directory}/node_modules/@vibeplan/templates`;
const templates = await import(pathToFileURL(`${templatePath}/dist/index.js`).href);
assert.match(templates.codexSkillInstructions(), /task:plan/);
assert.match(templates.codexSkillInstructions(), /task:progress/);
assert.match(templates.codexSkillInstructions(), /task:report/);
assert.match(templates.codexSkillInstructions(), /task:context/);
assert.match(templates.codexSkillInstructions(), /task:update/);
assert.match(templates.codexSkillInstructions(), /plan:run/);
assert.match(templates.codexSkillInstructions(), /auto-accept/);
const maintenance = await import(pathToFileURL(`${directory}/node_modules/@vibeplan/cli/dist/commands/maintenance.js`).href);
assert.throws(() => maintenance.validateMaintenancePatch({ status: 'done' }));
assert.deepEqual(maintenance.validateMaintenancePatch({ estimate: 2 }), { estimate: 2 });
assert.equal(maintenance.buildTaskContext({ id: 'isolated-task', projectId: 'isolated-project', version: 1, status: 'in_review' }).currentReport, null);
const cliPath = `${directory}/node_modules/@vibeplan/cli`;
const execution = await import(pathToFileURL(`${cliPath}/dist/commands/execution.js`).href);
const installer = await import(pathToFileURL(`${cliPath}/dist/commands/install-codex.js`).href);
const installedSkill = installer.installCodexSkill(`${directory}/isolated-codex`);
assert.equal(readFileSync(installedSkill, 'utf8'), installer.managedSkillTemplate());
assert.equal(installer.inspectCodexSkill(`${directory}/isolated-codex`).state, 'current');
const legacyHome = `${directory}/isolated-legacy-codex`;
const legacyPath = installer.installCodexSkill(legacyHome);
writeFileSync(legacyPath, 'User-owned legacy skill instructions.\n');
assert.throws(() => installer.installCodexSkill(legacyHome));
installer.installCodexSkill(legacyHome, true);
const legacyDirectory = legacyPath.slice(0, legacyPath.lastIndexOf('/'));
const backups = readdirSync(legacyDirectory).filter((name) => name.startsWith('SKILL.md.backup-'));
assert.equal(backups.length, 1);
assert.equal(readFileSync(`${legacyDirectory}/${backups[0]}`, 'utf8'), 'User-owned legacy skill instructions.\n');
assert.equal(readFileSync(legacyPath, 'utf8'), installer.managedSkillTemplate());
writeFileSync(installedSkill, `${readFileSync(installedSkill, 'utf8')}\nCustom instructions kept by package smoke.\n`);
installer.installCodexSkill(`${directory}/isolated-codex`);
assert.match(readFileSync(installedSkill, 'utf8'), /Custom instructions kept/);
assert.equal(installer.inspectCodexSkill(`${directory}/isolated-codex`).state, 'current');
const reportPath = `${directory}/isolated-report.json`;
writeFileSync(reportPath, JSON.stringify({ summary: 'Packed parser smoke', outcome: 'success', tests: [{ command: 'isolated test', result: 'passed', outcome: 'passed', exitCode: 0 }], criterionResults: [{ acceptanceItemId: 'isolated-criterion', result: 'passed', evidence: [] }] }));
const parsed = execution.readReportFile(reportPath);
assert.equal(parsed.summary, 'Packed parser smoke');
assert.equal(parsed.options.tests[0].exitCode, 0);
assert.equal(parsed.options.criterionResults[0].acceptanceItemId, 'isolated-criterion');
assert.deepEqual(execution.buildProgressPatch(45, 'testing', 'Packed progress smoke'), { progress: 45, executionStage: 'testing', executionNote: 'Packed progress smoke' });
for (const name of ['templates', 'cli']) {
  const pkg = JSON.parse(readFileSync(`${directory}/node_modules/@vibeplan/${name}/package.json`, 'utf8'));
  assert.equal(pkg.version, version);
  assert.ok(Object.values(pkg.dependencies ?? {}).every((value) => !value.startsWith('workspace:')));
}
NODE
if [[ -n "${VIBEPLAN_PACKED_TEST_SCRIPT:-}" ]]; then
  [[ "${VIBEPLAN_PACKED_API:-}" == 'http://localhost:4401' ]] || { echo 'Packed authenticated checks require the isolated local E2E API' >&2; exit 1; }
  [[ -n "${VIBEPLAN_PACKED_TEST_ROOT:-}" ]] || { echo 'Missing isolated packed test root' >&2; exit 1; }
  node "$VIBEPLAN_PACKED_TEST_SCRIPT" "$verification_dir/install" "$VIBEPLAN_PACKED_TEST_ROOT"
fi
echo "Verified isolated packed installation for @vibeplan/cli@$release_version and matching templates."
