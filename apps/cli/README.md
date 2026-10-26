# @vibeplan/cli

## AI-maintained tasks / AI 维护任务

Run `vibeplan start` in your bound project, then ask Codex or Claude Code: “Implement TASK_ID and maintain its plan, progress, blockers and actual test evidence.” Once the scope is authorized, the AI performs routine updates; you review acceptance. To resume, say “Continue TASK_ID and fix the review feedback in the same task.” The daemon synchronizes data; it does not independently execute development or read conversations.

在已绑定项目运行 `vibeplan start`，告诉 Codex 或 Claude Code：“实现 TASK_ID，并维护计划、进度、阻塞和真实测试报告。”授权范围内由 AI 日常维护，用户负责验收；继续时可以说：“继续 TASK_ID，在原任务修复退回的问题。”

```bash
vibeplan task:context TASK_ID
vibeplan task:update TASK_ID --task-version VERSION --file patch.json
vibeplan task:report TASK_ID --task-version VERSION --file report.json --git-base BASE_SHA
```

`task:context` reads the plan, recent events, current review issues and feedback retained across rejection cycles, plus local Git candidates. `task:update` accepts only scoped field changes and explained status changes; completion and review use their dedicated workflows. Example patch: `{"status":"blocked","executionStage":"blocked","executionNote":"Waiting for the API owner to confirm the schema"}`. Resume after resolution with `status=in_progress` and an explanation. `task:progress --stage blocked` now also records blocked status.

`task:context` 汇总计划、最近事件、验收问题、退回历史与本地 Git 候选；`task:update` 只接受范围内字段及有说明的状态变更，不能直接完成任务或进入验收。阻塞解除后由 AI 恢复执行并说明依据，退回问题优先原任务修复，不自动膨胀成许多子任务。

Optional `--git-base` collects committed changes since a task-scoped ancestor of HEAD. Verify the range; report `changedFiles` restricts collection when needed. Uncommitted paths must be explicitly scoped. No new commits means no inferred commit evidence. Git never proves tests, CI, hours or acceptance, and these commands never commit/push automatically. `--git-base` 可采集任务基线后的已提交文件；AI 需核对范围，未提交文件要明确列出，测试及验收不能推断。

After upgrading, run `vibeplan install-codex` for Codex or `vibeplan install-claude` for Claude Code, refresh project rules with `vibeplan init --project-id PROJECT_ID`, and restart the corresponding assistant/old daemons. Managed updates preserve custom instructions; differing legacy files require `--force` and are backed up. 升级后按使用的助手更新托管规则与项目规则，再重启助手和后台；本地开发的新功能需发布后才能通过 npm 安装获得。

Detailed workflow / 详细流程：本文末尾包含新版执行计划、进度、失败恢复、验收与项目分析的中英文说明。

Vibe Plan CLI connects a local coding project to the Vibe Plan server. It manages project binding, task creation, task execution status, local task mirrors, and the background synchronization daemon.

## Install

Requirements: Node.js 22 or newer, a Vibe Plan account, and access to a Vibe Plan project.

```bash
npm install --global @vibeplan/cli
vibeplan --help
```

Show the installed CLI version at any time:

```bash
vibeplan --version
```

The CLI defaults to `https://vibeplan.szxinjin.cn` and automatically uses its `/api` endpoint. For another deployed server:

```bash
vibeplan login --server https://your-domain.example
```

For a standalone API running locally, use its direct API URL:

```bash
vibeplan login --server http://localhost:4000
```

## First-time setup

### 1. Log in

```bash
vibeplan login
```

The command prints the Vibe Plan web address and a one-time device code, then waits for Enter to open the page in your browser. You can also copy the address and open it manually. Sign in, approve the code, and return to the terminal. The code is valid for 10 minutes and can be used once; run `vibeplan login` again when it expires or approval fails. The session is stored in the operating-system Keychain, not in the project or Git.

The default access token lasts 30 minutes and the refresh session lasts 90 days. The CLI automatically refreshes an expired access token and stores the replacement credentials in the operating-system Keychain. Each successful refresh renews the 90-day refresh window, so active users normally stay signed in. The server controls these values with `AUTH_ACCESS_TOKEN_TTL` and `AUTH_REFRESH_TOKEN_TTL`; the deployed server configuration is authoritative. Run `vibeplan login` again after the refresh window expires, `vibeplan logout`, credential revocation, or a server-side session reset. When `vibeplan start` runs in an interactive terminal with a missing or expired session, it shows `[1] Log in now  [2] Cancel`; after a successful device-code login it automatically continues starting the daemon. Scripts and the daemon only print the login command and never wait for input.

### 2. Bind a code project

Creating a cloud Vibe Plan project and binding a local code project are separate actions. Create or select the cloud project at [Projects](https://vibeplan.szxinjin.cn/projects), then copy the initialization command from its project card and run it in the matching local Git root. Binding does not create the cloud project again.

Run this in the local Git project directory:

```bash
vibeplan init --project-id PROJECT_ID
```

This creates `.vibe/project.yaml`, `.vibe/tasks/`, `.vibe/cache/`, `AGENTS.md`, and `.vibe/instructions.md`. If `AGENTS.md` already exists, Vibe Plan preserves your content and inserts or updates only a marked Vibe Plan managed block; it does not replace the file. If the directory is already bound to another project, the command refuses to overwrite it unless `--force` is provided; the previous `.vibe` directory is backed up first. When Codex finds an unbound directory while creating a task, it should direct you to the Projects page and this binding command, then resume task creation after binding without asking you to recreate the cloud project.

### 3. Install the Codex workflow

```bash
vibeplan install-codex
```

This installs the user-level Skill at `$CODEX_HOME/skills/vibe-plan/SKILL.md` (or `$HOME/.codex/skills/vibe-plan/SKILL.md`). Restart Codex after installation if it was already running.

After a CLI upgrade, install the latest task rules with:

```bash
npm install --global @vibeplan/cli@latest
vibeplan install-codex --force
```

Managed updates preserve custom text outside the Vibe Plan markers. A differing unmanaged legacy Skill requires explicit `--force`, which creates and announces a backup before migration. Restart Codex afterward.

### 3a. Install Claude Code project instructions

From the local project root, run:

```bash
vibeplan install-claude
```

This creates or updates the project-level `CLAUDE.md`. Claude Code uses the same `vibeplan task:*` workflow as Codex. Only the `VIBE PLAN CLAUDE MANAGED START/END` block is updated; custom content outside the block is preserved. An existing unmarked `CLAUDE.md` is not replaced by default. Review it first, then use `vibeplan install-claude --force` to back it up and migrate it.

### 4. Start local synchronization

In each bound project directory, start the same synchronization daemon in the background:

```bash
vibeplan start
```

`start` checks the project binding and login, installs the Codex Skill if it is missing, and starts the daemon. In an interactive terminal, it offers device-code login and continues automatically after approval. It then displays recent and live sync logs; press Ctrl-C to leave the log view while the daemon keeps running. A non-interactive `start` returns after launch. To reopen the logs later, run `vibeplan logs --follow`; `vibeplan logs` prints recent lines and returns. Only `vibeplan stop` stops this project's verified daemon. If your installed Skill has different content, it is left unchanged; review your customizations before using `vibeplan install-codex --force`. Restart Codex after installing or updating the Skill.

Use these as separate lifecycle commands:

```bash
vibeplan status       # account, project, task and synchronization summary
vibeplan status --verbose # IDs, Git commit and local diagnostics
vibeplan status --json    # machine-readable status for scripts
vibeplan logs         # recent log lines, then return
vibeplan logs --follow # attach to live logs; Ctrl-C detaches
vibeplan stop         # stop this project's background daemon
```

On an older CLI that does not have `logs`, use `tail -f .vibe/daemon.log`. The commands operate on the project in the current directory.

To watch synchronization in the current terminal instead, use:

```bash
vibeplan daemon --foreground
```

Both commands use the same daemon: it pulls task updates into `.vibe/tasks/`, retries offline updates from `.vibe/outbox/`, and writes diagnostic messages to `.vibe/daemon.log`. It does not execute code or start a local web server. `start` automatically removes a legacy lock only after confirming its recorded PID has exited. If the PID is still alive but cannot be verified, inspect the old daemon before removing `.vibe/daemon.lock`; `stop` will not signal an unverified process.

`vibeplan status` validates the saved login when the server is reachable, then reports the bound project, daemon, queued offline events, Git state, and task summary. It never prints access tokens, refresh tokens, passwords, or other secrets.

If the live log repeatedly says `Not logged in.`, run `vibeplan start` again in an interactive terminal and complete device-code login. The running daemon reads the renewed session on its next sync attempt. If `start` reports an unverifiable or stale lock, first run `vibeplan status`; stop the verified daemon with `vibeplan stop`, then retry `vibeplan start`. Do not delete a lock while its PID may still belong to another process.

## Daily workflow

Use the web app at `https://vibeplan.szxinjin.cn` to manage organizations, teams, projects, task lists, Gantt views, and approvals. Use Codex in the local project to work on code.

To manually synchronize without the daemon:

```bash
vibeplan task:sync
vibeplan task:list
vibeplan task:show TASK_ID
```

In Codex, say “把上面的任务加入 Vibe Plan”. Codex directly drafts the standard task fields and an editable estimate without asking for missing planning fields, then shows the complete summary for confirmation before creating the task. When no schedule is stated, the task is created without a due date. On its first start, Vibe Plan uses that day as the start date and calculates the end date from the estimate. Dates and estimates remain editable in the web app.

When `vibeplan start` or `vibeplan daemon --foreground` is running, `vibeplan task:sync` is automatic. Use it manually only for an immediate refresh or when the daemon is not running. To ask Codex to implement a task, say:

```text
请实现 Vibe Plan 任务 TASK_ID
```

Codex will run `vibeplan task:show`, show the acceptance criteria, ask for confirmation, run `vibeplan task:start`, modify the local Git project, run checks/tests, and submit `vibeplan task:report`. After you review the result, approve it with `vibeplan task:accept`.

Task status commands require the current version to prevent overwriting another user's changes:

```bash
vibeplan task:start TASK_ID --version VERSION
vibeplan task:report TASK_ID --version VERSION --summary "完成了任务"
vibeplan task:accept TASK_ID --version VERSION --decision approved
```

`task:report` moves a task to review. Only an approved acceptance record can move it to `done`.

## Local web clarification

The npm package does not run a local task-management website. The browser UI is the shared server application at the configured domain. Locally, Codex edits the Git working tree and the daemon synchronizes task metadata. The Markdown files under `.vibe/tasks/` are available as local context for Codex and editors, but they are not a second web UI.

## Useful commands

```bash
vibeplan whoami
vibeplan check
vibeplan logout
```

If the server is unavailable, task state changes are kept in `.vibe/outbox/` and retried by the daemon when connectivity returns. Never commit access tokens or `.vibe/outbox` contents to Git.

## English User Guide

### Install

Requirements: Node.js 22 or newer, a Vibe Plan account, and access to a Vibe Plan project.

```bash
npm install --global @vibeplan/cli
vibeplan --help
```

To display the installed CLI version:

```bash
vibeplan --version
```

The default server is `https://vibeplan.szxinjin.cn`. Override it when using another deployment with `vibeplan login --server https://your-domain.example`.

### First-time setup

1. Run `vibeplan login`, or run `vibeplan start` and choose `[1] Log in now` when prompted. The terminal prints a one-time device code that is valid for 10 minutes and can be used once. Open the Vibe Plan web app, sign in, approve the code, and return to the terminal. Credentials are stored in the operating-system Keychain. The CLI refreshes its 30-minute access token automatically and renews the default 90-day refresh window while it is used; actual durations come from `AUTH_ACCESS_TOKEN_TTL` and `AUTH_REFRESH_TOKEN_TTL` on the server. Sign in again after the refresh window expires, logout, revocation, or a server-side session reset. After login from `vibeplan start`, startup continues automatically.
2. In a local Git project, run `vibeplan init --project-id PROJECT_ID`. This creates the `.vibe` files and adds only a marked Vibe Plan block to an existing `AGENTS.md`, preserving your own instructions.
3. Run `vibeplan install-codex` and restart Codex. The Skill is installed under `$CODEX_HOME/skills/vibe-plan/` or `$HOME/.codex/skills/vibe-plan/`.
4. Run `vibeplan start` in the project directory. It displays live sync logs in an interactive terminal; Ctrl-C detaches the log view without stopping synchronization. Reopen it with `vibeplan logs --follow`, check the daemon with `vibeplan status`, or stop it with `vibeplan stop`. For foreground debugging, use `vibeplan daemon --foreground` instead. Both run the same synchronization loop. After upgrading the CLI, stop and restart each project's daemon; an already-running daemon keeps using its old code until restarted.

You can run one daemon per project in separate terminals. Each daemon uses that terminal's current project directory. A project-level `.vibe/daemon.lock` prevents two daemons from processing the same project at the same time.

### Daily workflow

Use the shared web app at `https://vibeplan.szxinjin.cn` for organizations, teams, projects, tasks, Gantt views, and approvals. In Codex, say “Add the task above to Vibe Plan” or provide a task ID. Codex asks for confirmation before creating or starting remote work.

When either daemon mode is running, task synchronization is automatic; `vibeplan task:sync` is only a manual immediate refresh. To implement a task, tell Codex:

```text
Implement Vibe Plan task TASK_ID
```

Codex reads the task with `vibeplan task:show`, displays the acceptance criteria, asks for confirmation, starts it with the required version, edits the local Git project, runs checks/tests, and submits an execution report. After review, approve it with `vibeplan task:accept`.

```bash
vibeplan task:sync
vibeplan task:list
vibeplan task:show TASK_ID
vibeplan task:start TASK_ID --version VERSION
vibeplan task:report TASK_ID --version VERSION --summary "Completed the task"
vibeplan task:accept TASK_ID --version VERSION --decision approved
```

`task:report` moves a task to review. Only an approved acceptance record can move it to `done`. Version numbers protect against overwriting another user's update.

### Local web clarification

The npm package does not start a local task-management website. The shared task UI runs on the server domain. Locally, Codex edits the Git working tree and the daemon synchronizes `.vibe/tasks/` and `.vibe/outbox/`. The daemon does not execute code remotely.

### Offline recovery

When the server is unavailable, pending events remain in `.vibe/outbox/` and are retried automatically. Check `.vibe/daemon.log` for synchronization errors. Do not commit access tokens or outbox contents to Git.

### Multiple projects and upgrades

Run one daemon per bound project directory. Start each from that project's Git root; `status`, `logs`, and `stop` never manage another directory. A computer restart does not automatically restart daemons, so run `vibeplan start` again for each project.

Upgrade the CLI and verify the executable being used:

```bash
npm install --global @vibeplan/cli@latest
vibeplan --version
vibeplan --help
command -v vibeplan
```

Then run `vibeplan install-codex --force` once if the Codex Skill needs the latest rules, restart Codex, and stop/start each active daemon. Existing `.vibe` bindings and task mirrors remain in place.

# 任务执行、进度与验收 / Task execution, progress and acceptance

## 中文

### 登录与同步

同一个操作系统用户的终端和多个项目共享 Keychain 登录。Access token 默认有效 30 分钟，refresh 会话默认 90 天，每次成功续期重新计算有效期。超过期限未使用、退出登录、撤销凭据或清空服务端会话时需要重新登录。网络中断和服务器临时故障不会清除新版 CLI 的凭据。

CLI 续期必须由服务器返回新 access/refresh token；旧服务器如果只设置浏览器 Cookie，会导致 CLI 续期失败。请同时更新服务器 API 和 CLI。升级 CLI 后，在每个项目根目录运行 `vibeplan stop`，再运行 `vibeplan start`，以重启使用旧代码的后台。

`vibeplan start` 启动同步并显示日志；未登录时可选择现在登录。Ctrl-C 退出日志查看，后台继续运行。用 `vibeplan logs --follow` 重新查看，用 `vibeplan status` 检查登录、绑定和待同步事件。后台只同步任务，不自动读取任意 Codex 对话或执行代码。网页和本地任务修改由它持续同步，无需日常手动运行 `task:sync`。

### 让 Codex 持续维护任务

升级并更新生成的 Skill：

```sh
npm install --global @vibeplan/cli
vibeplan --version
vibeplan install-codex
```

托管 Skill 更新保留标记外的自定义内容。没有标记且内容不同的旧 Skill 会保留；明确使用 `vibeplan install-codex --force` 时先备份并显示路径，再迁移。然后重启 Codex。在已绑定目录重新运行 `vibeplan init --project-id PROJECT_ID` 更新项目规则；`AGENTS.md` 只更新托管区块，保留用户其他规则。

对 Codex 说：“实现任务 TASK_ID，并在分析、修改、测试和提交验收时维护计划、进度与证据。”读完任务并确认范围后，同一范围不需要重复批准开始。没有明确排期时不填截止日期，首次开始后由估算计算日期；用户可在网页调整。

每次修改都会产生新版本。以下示例的 `VERSION` 必须换成上一步返回的版本，不能一直沿用初始版本：

```sh
vibeplan task:show TASK_ID
vibeplan task:start TASK_ID --task-version VERSION
vibeplan task:plan TASK_ID --task-version VERSION --file plan.md
vibeplan task:progress TASK_ID --task-version VERSION --progress 40 --stage testing --summary "已完成接口修改，正在验证并发路径"
vibeplan task:report TASK_ID --task-version VERSION --file report.json
```

阶段可以是 `analysis`、`implementation`、`testing`、`blocked`、`ready_for_review`。阶段回报记录实际工作，不等同于验收批准。详细计划应包含目标、范围、步骤、相关文件、依赖、风险、测试和验收对应。正文存数据库，后台生成本地 `.plan.md` 镜像；网页只读查看。

离线冲突、权限或校验错误会暂停操作。用 `vibeplan sync:pending` 检查原始内容与错误，解决后用 `vibeplan sync:discard EVENT_ID` 移除暂停项再提交新版本；这不会删除云端任务，请先保留报告内容。网络/5xx 保留重试，认证失效先登录。

### 执行报告和失败恢复

`report.json` 示例：

```json
{
  "summary": "完成接口修改；并发测试失败，已定位版本冲突，下一步修补事务边界",
  "outcome": "failed",
  "changedFiles": ["src/service.ts"],
  "tests": [{"command": "pnpm test", "result": "failed: concurrent-update case"}],
  "commit": null,
  "evidence": [],
  "risks": ["暂不具备交付条件"],
  "remainingIssues": ["修复并发更新；重跑相关测试"],
  "criterionResults": []
}
```

成功用 `success`，测试失败用 `failed`，外部阻塞用 `blocked`。失败保留进行中状态，阻塞报告标记阻塞，成功才进入待验收。测试结果、实际工时和证据必须来自真实执行。证据格式为 `{ "label": "测试记录", "url": "https://example.com/result" }`；逐项结果使用 `task:show` 返回的验收项 ID，格式为 `{ "acceptanceItemId": "ID", "result": "实际结果", "evidence": [] }`，仅作为证据，不自动通过该验收项。

报告保留已完成工作、失败命令及错误、尝试过程、剩余事项和下一步。新会话先读取任务、详细计划和历史再继续。阻塞解除后先用 `task:start` 恢复执行，再提交成功报告。版本冲突时读取最新任务并比较其他人的改动，不能盲目覆盖；认证、权限、校验和冲突不会作为可自动重试的新操作入队。网络或 5xx 可能排队，重发前检查状态与日志，避免重复。

### 网页验收、分析和复盘

任务详情可提交验收、查看报告、证据、逐项结果、变更历史、风险、阻塞来源和计划与实际对比。组织 owner/admin、团队 lead、项目 owner/admin/maintainer 可审核。必验项通过且存在本轮执行报告后才能批准完成；退回必须填写原因。已完成任务需先重新打开，才能更改验收标准或结论。

未开始执行进度为 0%，进行中为 1–99%，待验收与完成为 100%。父任务按有效子任务估算加权汇总，无估算按权重 1 计，取消任务不计。执行 100% 仍需用户验收。

“项目分析”显示有效叶子任务的验收完成率、逾期、阻塞、待验收、近 7 天批准趋势和成员负载，避免父子重复统计。贡献记录保留负责人交接，但不是绩效评分。计划估算以天计，工作记录以小时计，不自动换算。缺失值显示未记录；重开任务保留历史完成记录。截止日期和趋势按 UTC 计算。风险筛选支持逾期、48 小时内到期、至少 3 天停滞、落后计划至少 20 个百分点、阻塞及正常。

## English

### Sessions and synchronization

Terminals and projects under the same OS user share the Keychain session. Access tokens default to 30 minutes; refresh sessions default to 90 days and renew on successful refresh. Inactivity beyond expiry, logout, revocation or deletion of server sessions requires another login. Temporary network/server failures preserve credentials in the updated CLI.

Native refresh responses must include the rotated access and refresh tokens. An older server returning only browser cookies cannot renew CLI credentials correctly: update both API and CLI. After upgrading, run `vibeplan stop` and `vibeplan start` in each project to restart its old daemon.

`vibeplan start` offers login when necessary and streams sync logs. Ctrl-C detaches the viewer; use `vibeplan logs --follow` to return and `vibeplan status` to inspect login, binding and queued events. The daemon synchronizes task data; it does not inspect arbitrary Codex conversations or execute code. Routine `task:sync` is unnecessary while it runs.

### Maintaining tasks with Codex

Upgrade using `npm install --global @vibeplan/cli`, inspect `vibeplan --version`, and run `vibeplan install-codex`. Managed updates preserve custom text outside markers; explicit `--force` first backs up a differing unmanaged legacy Skill and announces the path. Restart Codex afterward. Run `vibeplan init --project-id PROJECT_ID` again in the bound directory to refresh project instructions. Only the managed block of `AGENTS.md` is updated.

Ask: “Implement TASK_ID and maintain its plan, progress and evidence at analysis, implementation, testing and review checkpoints.” Read the task and confirm its scope once; existing authorization covers continuation within that scope. Leave unscheduled deadlines empty until starting; users can adjust generated dates later.

Use the commands above, replacing `VERSION` with the version returned by each preceding mutation. `--task-version` avoids confusion with the CLI version flag. Upload a Markdown plan with goal, scope, steps, files, dependencies, risks, tests and acceptance mappings. The database stores its source, the daemon generates a local `.plan.md` mirror, and the web page displays it read-only.

Stages are `analysis`, `implementation`, `testing`, `blocked`, and `ready_for_review`. Stage updates record work; they do not approve acceptance.

Queued conflicts, permission and validation failures pause their operations. Inspect `vibeplan sync:pending`, resolve the problem, then use `vibeplan sync:discard EVENT_ID` to remove the paused operation before submitting the corrected version. Cloud tasks are not deleted; preserve report content first. Network/5xx errors remain retryable; expired authentication requires login.

### Reports, recovery and review

Use `task:report --file report.json` with the JSON fields shown above. Outcomes are `success`, `failed` and `blocked`. Failed reports retain active state, blocked reports record blocking, and successful delivery enters review. Record real test results and evidence only. Evidence entries use `{label,url}` with HTTP/HTTPS URLs. Criterion results use `{acceptanceItemId,result,evidence}`; copy IDs from `task:show`. AI evidence never replaces reviewer approval.

Preserve completed work, exact failed command/error, attempts, remaining issues and next steps in the report. A new session reads the task, plan and latest events before resuming. Explicitly resume a blocked task before reporting success. On version conflicts, reread and compare other changes before retrying; never overwrite blindly. Auth, permission, validation and conflict errors are not queued as new retryable operations. Network/5xx failures may queue a mutation: check status/logs before resubmitting.

The web task detail supports reports, evidence, criterion review, change history, risk/blocker explanations and planned-versus-actual comparisons. Reviewers are organization owners/admins, team leads and project owners/admins/maintainers. Approval requires passed mandatory criteria and a current execution report; rejection requires a reason. Reopen completed tasks before changing acceptance criteria or results.

Execution progress is 0 before starting, 1–99 while active, and 100 in review/done. Parent progress is recursively weighted by active child estimates, using weight 1 for missing estimates and excluding cancelled tasks. Execution at 100% is not approved completion.

“项目分析” (Project analysis) shows active leaf-task completion rate, overdue/blocked/review counts, seven-day approval trends and member workload. Handoff history is preserved; contribution is not a performance rating. Estimates use days and work logs use hours without an assumed conversion. Missing values remain unrecorded; reopening preserves completion history. Deadlines and trends use UTC. Risk filters cover overdue, due within 48 hours, stale for at least 3 days, progress lagging by at least 20 percentage points, blocked and normal.

### Structured evidence, work logs and safe recovery / 结构化证据、工时与恢复

Tests retain `command/result` and may add `outcome` (`passed`, `failed`, `skipped`, `not_run`) and an actual integer `exitCode`. Failed or nonzero-exit tests cannot support successful delivery; skipped/unexecuted tests are not passed tests. Upgrade servers lacking `structured-tests` before sending structured results; never silently omit them. Web drafts survive refresh for the current account. Rejection/reopening requires a new current-cycle report and fresh criterion reviews.

测试保持 `command/result` 兼容，可增加上述结构化状态与真实退出码。失败或非零退出码不能支持成功报告，跳过/未执行不算通过；旧 API 缺少 `structured-tests` 时先升级，不能静默丢字段。网页草稿刷新保留，被退回/重开的任务需新的本轮报告和逐项审核。

```sh
vibeplan task:log TASK_ID --hours 1.5 --content "Actual work" --date YYYY-MM-DD
vibeplan task:log-edit TASK_ID LOG_ID --log-version LOG_VERSION --reason "Correct record" --hours 1
vibeplan task:log-withdraw TASK_ID LOG_ID --log-version LOG_VERSION --reason "Duplicate record"
vibeplan status --verbose
```

Only the recording author can edit/withdraw their own work log, using the log's version and a reason; history remains auditable. Use observed hours, never inferred estimate conversions, elapsed wall time or commit counts. My Work surfaces assigned work, blockers, overdue items and reviews; contributions are not a performance rating.

工时作者只能修订/撤销自己的记录，使用记录版本并填写理由，保留审计历史。不从估算、运行时长或 Commit 数推算工时。“我的工作”展示已分配、阻塞、逾期和待审核任务，贡献数据不作为绩效评分。

Queue identity is immutable: a different login/server/project binding or a legacy entry lacking origin stays paused. Inspect `sync:pending`, preserve the payload and compare current task/binding, resolve identity, discard the paused event, then explicitly submit a replacement. Never relabel a queued operation with the current account or automatically replay approval.

队列绑定原服务器与账号。登录/项目来源不匹配或旧项缺少来源时暂停；查看 `sync:pending`，保留内容并核对任务、绑定和身份，解决后移除暂停项并明确重提，不自动补当前身份或重放审批。
## Batch plan execution / 批量执行计划

Requires a bound Vibe Plan project, authenticated CLI and installed/authenticated Codex CLI. The web “执行计划” modal copies commands; it cannot run local code. The synchronization daemon remains separate from execution.

```sh
# Use your project's actual command, expressed as argv, not shell source.
vibeplan plan:prepare --task TASK_UUID --check '["npm","test"]'
# Inspect/edit .vibe/batch-plan.json before authorizing execution.
vibeplan plan:run --file .vibe/batch-plan.json --approve
vibeplan plan:status --file .vibe/batch-plan.json
# After inspecting stopped checkpoints, logs and remote outcomes:
vibeplan plan:run --file .vibe/batch-plan.json --approve --resume
```

Repeat `--task` / `--check` as needed. Omitting `--task` selects unfinished leaf tasks. Preparation freezes cloud task scope, detailed plans, required criteria and dependencies. Customize `tasks[].checks` and `integrationChecks` in the manifest; each check is a nonempty JSON argv array run directly without shell interpolation. `--approve` authorizes this frozen scope, avoiding repeated task-start confirmation; it does not authorize commit, push, deployment or publication.

Tasks execute serially through workspace-write Codex, separate read-only review and real checks. Default successful reports await human acceptance; dependency successors wait until predecessors are accepted. Add `--auto-accept` only for explicit automatic acceptance authorization from a permitted reviewer, requiring passed checks and independent review of every mandatory criterion. Whole-plan integration results remain distinct from task acceptance. Repair attempts are bounded. Permission/conflict/scope-drift/ambiguous-operation failures require reconciliation; never replay uncertain approval blindly. New scope requires new preparation and authorization. Use a CLI version containing these commands; unpublished source changes are not available through npm yet.

在已绑定目录准备云端任务快照，确认 `.vibe/batch-plan.json` 的范围、计划、验收、依赖、各任务 checks 与整体验证 integrationChecks 后授权运行。测试命令必须来自项目真实工具，JSON 参数直接执行。默认人工验收，依赖等待已验收前置任务；仅明确授权并具备审核权限时使用 --auto-accept，且测试与独立复核必须通过。浏览器只复制命令、daemon 只同步，本地 Codex 串行实施并单独复核。中断先核对记录和云端结果，再显式 --resume；范围变化需重新准备与授权，整体验证结果单独记录，不自动提交、推送、部署或发布。

已有清单不会被准备命令覆盖；新范围使用 `plan:prepare --file .vibe/batch-plan-next.json` 并重新授权。清单 maxAttempts 默认 2、可配置 1–3（最多额外重试两次）。集成检查失败时批次保持失败，即使部分任务已验收，也不代表整个计划已验收。

Preparation never overwrites an existing manifest; use `plan:prepare --file .vibe/batch-plan-next.json` for a new authorized scope. maxAttempts defaults to 2 and allows 1–3 implementation attempts (at most two extra retries). Failed integration checks leave the batch failed even if individual tasks were accepted; never infer whole-plan acceptance.
