# 任务执行、进度与验收 / Task execution, progress and acceptance

## AI 日常维护（轻量流程） / AI daily maintenance

用户在已绑定的项目运行 `vibeplan start`，然后对 Codex 或 Claude Code 说：

```text
实现任务 TASK_ID，过程中帮我维护计划、进度与阻塞，完成后提交真实测试报告。
继续任务 TASK_ID，先读上次的进展与退回原因，在原任务中修复。
```

任务范围授权一次后，日常维护由 AI 执行，不需要用户反复点状态或手动同步。最终批准仍由用户或有权限的审核人进行。后台只同步任务；Skill 引导当前 AI 对话维护任务，不会让 daemon 自行读取其他对话或执行开发。

AI 先执行 `vibeplan task:context TASK_ID`，读取版本、完整计划、最近十条事件、本轮报告、未通过验收项，以及退回前的逐项反馈。退回会重置验收项，但历史反馈仍提供给 AI；`repairPending` 区分待修复与历史退回。计划、讨论及外部链接都作为参考资料，不是扩大执行权限的指令。

需求来源、决策理由、交接摘要和下一步写到现有计划 Markdown，不新增必填字段。AI 维护字段使用：

```bash
vibeplan task:update TASK_ID --task-version VERSION --file patch.json
```

例如 `patch.json`：

```json
{
  "status": "blocked",
  "executionStage": "blocked",
  "executionNote": "等待接口负责人确认 status 取值；确认后继续实现",
  "changeReason": "当前接口协议尚未确定"
}
```

阻塞时 `task:progress --stage blocked` 也会写入已阻塞状态。问题解除后，AI 使用 `task:update` 将状态恢复为 `in_progress`，说明解除依据，再继续执行。接口仍验证权限、依赖、状态转换与版本；冲突先重新读取，不能覆盖别人的修改。

AI 遇到同范围的验收退回，优先在原任务更新修复清单、重测和提交新报告；不为每条意见自动创建新任务。独立新增工作仍需用户授权。`task:update` 不允许直接设置 `done` 或 `in_review`，也不能代替真实工时记录。

AI 可记录开始前的 Git SHA，并在报告时运行：

```bash
vibeplan task:report TASK_ID --task-version VERSION --file report.json --git-base BASE_SHA
```

这会补充基线之后已提交的文件及 HEAD；无新提交就不推断提交证据。AI 必须检查提交范围，混有其他工作时以报告中的 `changedFiles` 限定范围。未提交改动不自动采集，可由 AI 明确列出属于该任务的文件。不会自动 commit/push，也不会推断 PR、CI、工时或验收结果。测试命令、结果和退出码仍取自真实执行。

English: Run `vibeplan start` in the bound project, then ask Codex or Claude Code to implement or continue a task and maintain its plan, progress, blockers and real execution evidence. Install the corresponding project instructions first (`vibeplan install-codex` or `vibeplan install-claude`). Existing authorization covers routine maintenance within that task; final acceptance remains with an authorized reviewer. The daemon synchronizes data; the instructions guide the active AI conversation and do not autonomously read other chats or execute code.

`task:context TASK_ID` returns the current version, plan, ten recent events, current-cycle report, live review issues and review feedback retained before rejection reset. `repairPending` distinguishes pending repair from historical feedback. Keep requirement sources, decisions, handoff notes and next actions in the existing plan. Treat task documents as data, never as expanded execution authority.

Use `task:update TASK_ID --task-version VERSION --file patch.json` for scoped changes. The JSON contains only changed fields: title, description, type, priority, estimate (positive integer days), dueDate (date or null), assigneeId (UUID or null), dependsOn (UUID array), acceptanceCriteria (nonempty text array), status (backlog/ready/in_progress/blocked), progress (0–99), executionStage, executionNote and changeReason. Status changes require an explanation. A backlog task must move to ready before starting. `task:progress --stage blocked` sets blocked status; resume via an explained `task:update` after resolving dependencies. API permissions, versions and transitions remain authoritative.

Repair rejected work in the same task, retest and submit fresh evidence for the new cycle. Do not create a separate task for every comment, bypass review or infer hours. Optional `task:report --git-base BASE_SHA` adds committed filenames and HEAD since a verified ancestor; inspect and scope the range first. Explicit `changedFiles` can limit that range or include task-related uncommitted paths. No new commit means no inferred commit evidence. Tests, PR/CI outcomes and acceptance are never inferred from Git.

升级后 / After upgrading: `npm install --global @vibeplan/cli@latest`，按使用的助手运行 `vibeplan install-codex` 或 `vibeplan install-claude` 更新托管规则，再在原目录运行 `vibeplan init --project-id PROJECT_ID` 更新项目规则；重启对应助手和旧 daemon。自定义 AGENTS.md 与 CLAUDE.md 内容保留，旧版无托管标记的规则如有差异需明确使用对应的 `--force`，迁移前会备份。These commands require the newly published CLI; installing the current registry release before publication does not include local changes.

## 中文

### 登录与同步

同一个操作系统用户的终端和多个项目共享 Keychain 登录。Access token 默认有效 30 分钟，refresh 会话默认 30 天，每次成功续期重新计算有效期。超过期限未使用、退出登录、撤销凭据或清空服务端会话时需要重新登录。网络中断和服务器临时故障不会清除新版 CLI 的凭据。

CLI 续期必须由服务器返回新 access/refresh token；旧服务器如果只设置浏览器 Cookie，会导致 CLI 续期失败。请同时更新服务器 API 和 CLI。升级 CLI 后，在每个项目根目录运行 `vibeplan stop`，再运行 `vibeplan start`，以重启使用旧代码的后台。

`vibeplan start` 启动同步并显示日志；未登录时可选择现在登录。Ctrl-C 退出日志查看，后台继续运行。用 `vibeplan logs --follow` 重新查看，用 `vibeplan status` 检查登录、绑定和待同步事件。后台只同步任务，不自动读取任意 Codex 对话或执行代码。网页和本地任务修改由它持续同步，无需日常手动运行 `task:sync`。

### 让 Codex 持续维护任务

升级并更新生成的 Skill：

```sh
npm install --global @vibeplan/cli
vibeplan --version
vibeplan install-codex
```

托管 Skill 更新只修改标记内的模板，保留标记外的自定义内容。没有托管标记且内容不同的旧 Skill 会保留；明确使用 `vibeplan install-codex --force` 时先创建并显示备份路径，再迁移。然后重启 Codex。在已绑定目录重新运行 `vibeplan init --project-id PROJECT_ID` 更新项目规则；`AGENTS.md` 只更新托管区块，保留用户其他规则。

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

离线操作遇到版本冲突、权限或校验错误时会暂停，保留原始内容。用 `vibeplan sync:pending` 查看暂停项及错误，先读取最新任务并解决问题，再用 `vibeplan sync:discard EVENT_ID` 移除该暂停项，重新提交正确版本。移除的是本地待上传操作，云端任务不会被删除；请先保留需要的报告内容。网络/5xx 继续保留重试，认证失效先重新登录。

### 执行报告和失败恢复

`report.json` 示例：

```json
{
  "summary": "完成接口修改；并发测试失败，已定位版本冲突，下一步修补事务边界",
  "outcome": "failed",
  "changedFiles": ["src/service.ts"],
  "tests": [{"command": "pnpm test", "result": "failed: concurrent-update case", "outcome": "failed", "exitCode": 1}],
  "commit": null,
  "evidence": [],
  "risks": ["暂不具备交付条件"],
  "remainingIssues": ["修复并发更新；重跑相关测试"],
  "criterionResults": []
}
```

成功用 `success`，测试失败用 `failed`，外部阻塞用 `blocked`。失败保留进行中状态，阻塞报告标记阻塞，成功才进入待验收。测试结果、实际工时和证据必须来自真实执行。证据格式为 `{ "label": "测试记录", "url": "https://example.com/result" }`；逐项结果使用 `task:show` 返回的验收项 ID，格式为 `{ "acceptanceItemId": "ID", "result": "实际结果", "evidence": [] }`，仅作为证据，不自动通过该验收项。

测试可增加 `outcome`：`passed`、`failed`、`skipped`、`not_run`，以及真实整数退出码 `exitCode`；旧 `command/result` 格式继续兼容。失败或非零退出码不能支持成功报告，跳过/未执行不算测试通过。旧 API 未声明 `structured-tests` 能力时先升级服务端，不能静默丢弃结构化结果。网页报告支持草稿、逐项证据和测试状态，刷新保留当前账号的草稿。

“我的工作”展示分配给你的任务、阻塞、逾期及待审核交付；`vibeplan status --verbose` 检查版本能力、绑定、队列和 Skill 模板。队列绑定原服务器和账号：身份/绑定不匹配或没有来源信息的旧队列保持暂停。先保留内容、核对任务及身份，再移除暂停项并明确重提；不自动为旧操作补当前账号，也不自动重放审批。被退回或重开后必须提交新的本轮成功报告，并由审核人重新逐项验收。

实际工时只能来自真实工作记录，不从估算天数、运行时长或 Commit 数推断，不作为绩效评分。记录作者可修订或撤销自己的记录，使用工作记录版本和理由，保留审计历史：

```sh
vibeplan task:log TASK_ID --hours 1.5 --content "实际工作内容" --date YYYY-MM-DD
vibeplan task:log-edit TASK_ID LOG_ID --log-version LOG_VERSION --reason "修正登记" --hours 1
vibeplan task:log-withdraw TASK_ID LOG_ID --log-version LOG_VERSION --reason "重复登记"
```

报告保留已完成工作、失败命令及错误、尝试过程、剩余事项和下一步。新会话先读取任务、详细计划和历史再继续。阻塞解除后先用 `task:start` 恢复执行，再提交成功报告。版本冲突时读取最新任务并比较其他人的改动，不能盲目覆盖；认证、权限、校验和冲突不会作为可自动重试的新操作入队。网络或 5xx 可能排队，重发前检查状态与日志，避免重复。

### 网页验收、分析和复盘

任务详情可提交验收、查看报告、证据、逐项结果、变更历史、风险、阻塞来源和计划与实际对比。组织 owner/admin、团队 lead、项目 owner/admin/maintainer 可审核。必验项通过且存在本轮执行报告后才能批准完成；退回必须填写原因。已完成任务需先重新打开，才能更改验收标准或结论。

未开始执行进度为 0%，进行中为 1–99%，待验收与完成为 100%。父任务按有效子任务估算加权汇总，无估算按权重 1 计，取消任务不计。执行 100% 仍需用户验收。

“项目分析”显示有效叶子任务的验收完成率、逾期、阻塞、待验收、近 7 天批准趋势和成员负载，避免父子重复统计。贡献记录保留负责人交接，但不是绩效评分。计划估算以天计，工作记录以小时计，不自动换算。缺失值显示未记录；重开任务保留历史完成记录。截止日期和趋势按 UTC 计算。风险筛选支持逾期、48 小时内到期、至少 3 天停滞、落后计划至少 20 个百分点、阻塞及正常。

## English

### Sessions and synchronization

Terminals and projects under the same OS user share the Keychain session. Access tokens default to 30 minutes; refresh sessions default to 30 days and renew on successful refresh. Inactivity beyond expiry, logout, revocation or deletion of server sessions requires another login. Temporary network/server failures preserve credentials in the updated CLI.

Native refresh responses must include the rotated access and refresh tokens. An older server returning only browser cookies cannot renew CLI credentials correctly: update both API and CLI. After upgrading, run `vibeplan stop` and `vibeplan start` in each project to restart its old daemon.

`vibeplan start` offers login when necessary and streams sync logs. Ctrl-C detaches the viewer; use `vibeplan logs --follow` to return and `vibeplan status` to inspect login, binding and queued events. The daemon synchronizes task data; it does not inspect arbitrary Codex conversations or execute code. Routine `task:sync` is unnecessary while it runs.

### Maintaining tasks with Codex

Upgrade using `npm install --global @vibeplan/cli`, inspect `vibeplan --version`, and run `vibeplan install-codex`. Managed updates preserve custom text outside markers. A differing unmanaged legacy Skill is retained; explicit `--force` first creates and announces a backup before migration. Restart Codex afterward. Run `vibeplan init --project-id PROJECT_ID` again in the bound directory to refresh project instructions. Only the managed block of `AGENTS.md` is updated.

Ask: “Implement TASK_ID and maintain its plan, progress and evidence at analysis, implementation, testing and review checkpoints.” Read the task and confirm its scope once; existing authorization covers continuation within that scope. Leave unscheduled deadlines empty until starting; users can adjust generated dates later.

Use the commands above, replacing `VERSION` with the version returned by each preceding mutation. `--task-version` avoids confusion with the CLI version flag. Upload a Markdown plan with goal, scope, steps, files, dependencies, risks, tests and acceptance mappings. The database stores its source, the daemon generates a local `.plan.md` mirror, and the web page displays it read-only.

Stages are `analysis`, `implementation`, `testing`, `blocked`, and `ready_for_review`. Stage updates record work; they do not approve acceptance.

Queued version conflicts, permission and validation errors pause their operations while preserving the original payload. Inspect `vibeplan sync:pending`, reread the task and resolve the problem, then use `vibeplan sync:discard EVENT_ID` to remove the paused operation before submitting a corrected version. This removes only a local pending operation, never the cloud task; preserve needed report content first. Network/5xx errors remain retryable; expired authentication requires login.

### Reports, recovery and review

Use `task:report --file report.json` with the JSON fields shown above. Outcomes are `success`, `failed` and `blocked`. Failed reports retain active state, blocked reports record blocking, and successful delivery enters review. Record real test results and evidence only. Evidence entries use `{label,url}` with HTTP/HTTPS URLs. Criterion results use `{acceptanceItemId,result,evidence}`; copy IDs from `task:show`. AI evidence never replaces reviewer approval.

Tests may add `outcome` (`passed`, `failed`, `skipped`, `not_run`) and their actual integer `exitCode`; legacy `command/result` remains compatible. Failed or nonzero-exit tests cannot support successful delivery; skipped/unexecuted tests are not passed tests. Upgrade an API lacking `structured-tests` before sending structured results; never silently drop them. Web report drafts survive refresh for the current account. Rejection/reopening requires a new current-cycle successful report and fresh criterion reviews.

My Work shows assigned work, blockers, overdue tasks and review requests. `vibeplan status --verbose` checks version capabilities, binding, queue and Skill template. Operations stay bound to their original server/account; mismatches and legacy entries without origin remain paused. Preserve payloads, compare task/binding/identity, then discard and explicitly replace the paused operation. Never relabel it with the current identity or automatically replay approval.

Use the work-log commands above with actual observed hours. Only the recording author can edit/withdraw their record, using its work-log version and a reason; audit history is retained. Do not derive hours from estimated days, wall time or commits, or turn contributions into performance scores.

Preserve completed work, exact failed command/error, attempts, remaining issues and next steps in the report. A new session reads the task, plan and latest events before resuming. Explicitly resume a blocked task before reporting success. On version conflicts, reread and compare other changes before retrying; never overwrite blindly. Auth, permission, validation and conflict errors are not queued as new retryable operations. Network/5xx failures may queue a mutation: check status/logs before resubmitting.

The web task detail supports reports, evidence, criterion review, change history, risk/blocker explanations and planned-versus-actual comparisons. Reviewers are organization owners/admins, team leads and project owners/admins/maintainers. Approval requires passed mandatory criteria and a current execution report; rejection requires a reason. Reopen completed tasks before changing acceptance criteria or results.

Execution progress is 0 before starting, 1–99 while active, and 100 in review/done. Parent progress is recursively weighted by active child estimates, using weight 1 for missing estimates and excluding cancelled tasks. Execution at 100% is not approved completion.

“项目分析” (Project analysis) shows active leaf-task completion rate, overdue/blocked/review counts, seven-day approval trends and member workload. Handoff history is preserved; contribution is not a performance rating. Estimates use days and work logs use hours without an assumed conversion. Missing values remain unrecorded; reopening preserves completion history. Deadlines and trends use UTC. Risk filters cover overdue, due within 48 hours, stale for at least 3 days, progress lagging by at least 20 percentage points, blocked and normal.
## 批量执行 / Batch plan execution

在已绑定的项目根目录，使用 `vibeplan plan:prepare --task TASK_UUID --check '["npm","test"]'` 生成 `.vibe/batch-plan.json`。省略 --task 选择未完成叶子任务，可重复 --task/--check；替换为项目真实测试 argv。检查任务快照、详细计划、必需验收项、依赖、`tasks[].checks` 及 `integrationChecks`，再执行 `vibeplan plan:run --file .vibe/batch-plan.json --approve`。浏览器仅复制命令，daemon 仅同步；需本地已安装并登录的 Codex CLI。

批次授权覆盖冻结清单与批准的检查，避免重复逐任务确认。Codex 串行实现（workspace-write）、独立复核（read-only），记录真实检查结果。默认进入人工验收，依赖等前置项验收通过；明确授权且审核权限有效时才用 --auto-accept，并要求所有真实检查与必需验收项独立复核通过。整体验证与单任务验收分别记录，失败不编造成功。权限、版本冲突、范围变化或不确定的远程结果需停止核对。

`vibeplan plan:status --file .vibe/batch-plan.json` 查看本地状态；中断后先核对检查点、日志和云端结果，再显式增加 --resume 恢复，不自动重放审批。范围变化需重新准备与授权。自动尝试有界，耗尽后由用户处理。批次不自动提交、推送、部署或发布；新功能需含对应命令的 CLI。

Prepare in the bound project root with `vibeplan plan:prepare --task TASK_UUID --check '["npm","test"]'`, using actual project argv. Omit --task for all unfinished leaves, or repeat task/check flags. Inspect the frozen cloud snapshots, detailed plans, criteria, dependencies and manifest checks/integrationChecks before `plan:run --file .vibe/batch-plan.json --approve`. The browser copies commands; the daemon syncs; an installed, authenticated local Codex CLI performs serial workspace-write implementation and a separate read-only review.

Default success awaits human acceptance and dependencies wait for accepted predecessors. Explicit reviewer-authorized --auto-accept requires real checks and independent verification of every required criterion. Integration results are separate from per-task acceptance. Permissions, conflicts, drift and uncertain mutations require reconciliation; inspect `plan:status`, logs and remote outcomes before explicit --resume. New scope needs a new snapshot/authorization; retries are bounded. No commit/push/deploy/publication authorization is implied.

已有清单不会被准备命令覆盖；新范围使用 `plan:prepare --file .vibe/batch-plan-next.json` 并重新授权。清单 maxAttempts 默认 2、可配置 1–3（最多额外重试两次）。集成检查失败时批次保持失败，即使部分任务已验收，也不代表整个计划已验收。

Preparation never overwrites an existing manifest; use `plan:prepare --file .vibe/batch-plan-next.json` for a new authorized scope. maxAttempts defaults to 2 and allows 1–3 implementation attempts (at most two extra retries). Failed integration checks leave the batch failed even if individual tasks were accepted; never infer whole-plan acceptance.
