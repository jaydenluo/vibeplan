# Isolated workflow verification

Run a PostgreSQL test instance at `localhost:5433` with database `vibe_plan_test`
and user/password `vibe` (the existing test database is supported). Then run:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
pnpm verify:package
```

Playwright starts its own API at `localhost:4401`, Vite at `localhost:4402`,
and a local `/api` reverse proxy at `localhost:4403` for packed CLI validation.
Existing servers are never reused. The test API has its own increased per-IP
request budget for the multi-browser fixture, without changing production
defaults. The API entry point sets the local test
database explicitly and never loads `.env`; Vite uses an explicit local API URL
and no proxy target. Fixtures create unique UUID-named users and organizations
through the API, then delete only their own records from the test database.
No production project, keychain login, npm publish or global install is used.

The lifecycle test covers plans, start, progress, handoff history, failed report,
repair, successful report, member review denial, missing required criteria,
empty rejection reason, stale version and unfinished dependency. Two real
browser contexts verify member permission visibility, reviewer rejection,
structured reports with draft persistence after refresh, resubmission,
individual criterion review, approval and two refresh-cookie recoveries. Native-session tests
exercise two concurrent independent sessions and two returned-token rotations
against short-lived access JWTs. Shared-keychain CLI serialization is covered by
the CLI auth-lock regression tests, not these independent HTTP sessions.

The packed CLI E2E test installs actual tarballs into a temporary prefix and
replaces the child process's keychain adapter entirely with memory before loading
any packed commands. It invokes shipped plan/start/progress/work-log/report
commands through the real isolated API and verifies a committed report whose
response is deliberately lost: the persisted mutation ID retries with the old
version, returns the original result, and leaves exactly one report event.
It never calls the native keychain adapter or changes the user's login.

`pnpm verify:package` builds/packs CLI and templates and installs them in a
temporary prefix; it checks version, command help, Skill contents and isolated
Skill installation, the shipped structured report-file parser/progress payload,
public dependency resolution and absence of template test artifacts. The
standalone smoke does not execute authenticated task commands; `pnpm test:e2e`
also runs the packed authenticated command fixture described above.

An older outbox without an origin remains paused because its server/account
cannot be proved. Inspect it with `vibeplan sync:pending`, preserve its original
payload, compare current task scope/version and session/project binding, then
discard that paused event and explicitly submit a replacement. Never silently
attach the current account or replay an approval under a new version.

Managed Skill updates preserve custom text outside their markers. Differing
unmanaged legacy Skills require an explicit `install-codex --force`, which first
writes and announces a uniquely named backup. Compare the installed template
with `inspectCodexSkill`; do not mistake custom text for a stale template.

After an authorized release, read-only metadata and registry package checks are:

```sh
bash scripts/verify-release.sh X.Y.Z https://your-deployment-api
```

The command requires an explicit deployment URL and compares its version with
the requested release. Healthy metadata alone is not business acceptance.
Browser failure traces and the HTML report are generated in ignored
`test-results/` and `playwright-report/` directories.
