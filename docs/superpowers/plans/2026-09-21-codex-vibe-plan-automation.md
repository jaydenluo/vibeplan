# Codex Vibe Plan Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在 Codex 对话中说“把上面的任务加入 Vibe Plan”即可经过确认创建标准任务，复制任务 ID 后让 Codex 读取并执行任务，同时由本地后台将任务状态和报告可靠同步到云端。

**Architecture:** PostgreSQL 中的任务数据是唯一事实来源，Fastify API 负责权限、任务状态和版本冲突，Web 通过 SSE 接收实时更新。每个代码项目运行一个本地 `vibeplan daemon`，使用 Keychain 中的凭据将本地任务镜像和离线 outbox 同步到服务器；代码执行始终发生在用户本地的 Codex 会话中，服务器不远程执行代码。Codex 通过项目生成的 `AGENTS.md/.vibe/instructions.md` 和可安装的 Vibe Plan Skill 识别任务意图，所有远程写入都需要用户的明确确认。

**Tech Stack:** Node.js 22、pnpm 11、TypeScript、Fastify、PostgreSQL、Drizzle ORM、Zod、Vitest、React/Vite、Commander、SSE、Keychain、Docker Compose。

---

## 当前基线与范围

当前已完成并应保留：组织、团队、项目和成员权限；标准任务创建表单；任务树、甘特图、任务详情；任务状态、优先级、截止日期、预估工时、描述和验收标准；API SSE 事件；`vibeplan login/init/task:list/task:start/task:report/check`；项目级 `AGENTS.md` 和 `.vibe/instructions.md` 模板。

当前不具备：`task:create/show`、可复制的 Codex 任务协议、本地 daemon、离线 outbox、Codex Skill 安装、自然语言创建任务、结构化执行报告，以及可直接公网部署的 SMTP/API 反向代理配置。

## 任务标准

所有新建任务必须包含以下字段：

```json
{
  "title": "任务标题",
  "type": "feature",
  "status": "backlog",
  "priority": "P1",
  "dueDate": "2026-10-20",
  "estimate": 3,
  "description": "可执行的任务描述",
  "acceptanceCriteria": ["可验证的验收条件"]
}
```

负责人、父任务、Git 提交、修改文件和测试结果属于可选协作字段。任务创建接口拒绝缺少必填字段；已存在的历史任务允许继续读取和渐进补齐。

## 对话目标流程

1. 用户在已初始化的项目中告诉 Codex 规划或实现一项工作。
2. Codex 发现“加入 Vibe Plan”意图后，提取标题、类型、状态、时间、工时、描述和验收标准。
3. 缺字段时只询问缺失字段；字段完整时展示摘要并询问是否创建。
4. 用户确认后，Codex 调用 `vibeplan task:create`，返回任务 ID 和 Web 链接。
5. 用户复制任务 ID，要求“实现任务 `<id>`”；Codex 调用 `vibeplan task:show <id>`，展示任务并询问是否开始。
6. 用户确认后调用 `vibeplan task:start <id> --version <version>`，本地修改代码并运行测试。
7. Codex 调用 `vibeplan task:report <id> --version <version> --summary ...`；daemon 上传修改后的任务镜像和事件，Web 实时刷新。
8. 只有验收证据齐全且用户确认后，任务才允许进入 `done`。

## 任务 1：验证并固化任务 API 合同

**Files:**
- Modify: `apps/api/src/modules/work-items/work-items.test.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/db/schema.ts`（只在新增报告字段时修改）
- Modify: `apps/api/src/db/migrate.ts`（只在新增报告表时修改）

- 当前状态：创建表单、Zod schema 和 `WorkItemService.create` 已经要求并保存标准字段；本任务只补齐 HTTP 合同测试和历史任务兼容检查，不重复修改已通过的生产实现。

- [ ] **Step 1: 写 API 合同测试**

在 `apps/api/src/app.test.ts` 增加 POST `/projects/:projectId/work-items` 的验证测试：完整 payload 返回 `201`；缺少 `status`、`dueDate`、`estimate`、`description` 或空 `acceptanceCriteria` 返回 `400`。测试必须使用测试服务替身和真实 Zod 路由解析，不绕过 HTTP 层。

- [ ] **Step 2: 运行合同测试**

运行：

```bash
DATABASE_URL=postgres://$(whoami)@localhost:55433/vibe_plan_test pnpm vitest run apps/api/src/app.test.ts --no-file-parallelism
```

预期：完整 payload 返回 `201`，缺字段 payload 返回 `400`；如果出现回归，先修复 schema 或路由再继续后续任务。

- [ ] **Step 3: 验证历史任务读取**

使用一个缺少新字段的历史任务 fixture 调用 `GET /projects/:projectId/work-items`，确认列表和详情仍能返回；更新历史任务时只提交 `version` 加一个可修改字段，确认不要求一次性补齐所有创建字段。

- [ ] **Step 4: 运行 API 与服务测试**

运行：

```bash
DATABASE_URL=postgres://$(whoami)@localhost:55433/vibe_plan_test pnpm vitest run apps/api/src/app.test.ts apps/api/src/modules/work-items/work-items.test.ts --no-file-parallelism
```

预期：所有测试通过，并验证创建事件包含任务标题、历史任务仍可读取和部分更新。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/app.test.ts apps/api/src/modules/work-items apps/api/src/db
git commit -m "test: lock down standard work item contract"
```

## 任务 2：增加 CLI 创建、读取和明确确认流程

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/api-client.ts`
- Modify: `apps/cli/src/commands/task.ts`
- Create: `apps/cli/src/commands/task-create.ts`
- Create: `apps/cli/src/commands/task-show.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Modify: `README.md`

- [ ] **Step 1: 写 CLI 命令测试**

在 `apps/cli/src/cli.test.ts` 覆盖以下参数到请求体的映射：

```bash
vibeplan task:create --title "实现任务同步" --type feature --status backlog --priority P1 --due-date 2026-10-20 --estimate 3 --description "同步状态" --acceptance "状态可实时显示" --acceptance "失败可重试"
vibeplan task:show TASK_ID
```

断言创建请求包含 `acceptanceCriteria: ["状态可实时显示", "失败可重试"]`，show 命令打印 JSON 或可读摘要，并在无 `.vibe/project.yaml` 时给出初始化提示。

- [ ] **Step 2: 运行 CLI 测试确认失败**

运行：`pnpm vitest run apps/cli/src/cli.test.ts --no-file-parallelism`

预期：Commander 找不到 `task:create` 或 `task:show`。

- [ ] **Step 3: 实现 ApiClient 和命令**

在 `ApiClient` 增加 `createWorkItem(projectId, input)` 和 `workItem(id)`；命令从项目配置取得 `projectId`，从 Keychain 取得 session，创建成功打印 `id/version`。`task:show` 接受 UUID 任务 ID，并显示标准字段、验收标准和当前版本。

- [ ] **Step 4: 统一现有命令格式**

保留 Commander 的冒号命令作为正式格式：`task:list`、`task:create`、`task:show`、`task:start`、`task:report`。更新模板中错误的 `vibeplan task start ID` 文案，所有状态修改命令必须要求 `--version`，避免覆盖其他用户的更新。

- [ ] **Step 5: 运行测试并提交**

运行：`pnpm vitest run apps/cli/src/cli.test.ts --no-file-parallelism && pnpm --filter @vibeplan/cli build`

预期：CLI 测试全部通过，生成 `apps/cli/dist/index.js`。

```bash
git add apps/cli README.md
git commit -m "feat: add task create and show commands"
```

## 任务 3：实现本地任务镜像和同步 outbox

**Files:**
- Create: `apps/cli/src/sync/task-mirror.ts`
- Create: `apps/cli/src/sync/outbox.ts`
- Create: `apps/cli/src/sync/events.ts`
- Create: `apps/cli/src/commands/sync.ts`
- Create: `apps/cli/src/commands/daemon.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/config.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Modify: `packages/templates/src/index.ts`

- [ ] **Step 1: 写 outbox 和镜像测试**

测试以下行为：服务器请求失败时写入 `.vibe/outbox/<event-id>.json`；网络恢复后按创建时间顺序重试并删除成功事件；服务器返回版本冲突时保留事件、写入冲突日志且不覆盖本地文件；`task:sync` 将远程任务写为 `.vibe/tasks/<id>.md`，内容包含 front matter 中的 `id/version/status` 和 Markdown 验收清单。

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm vitest run apps/cli/src/cli.test.ts --no-file-parallelism`

预期：同步模块不存在，测试失败。

- [ ] **Step 3: 实现镜像和 outbox**

使用原子临时文件加 rename 写入镜像；outbox 事件包含 `id/type/payload/createdAt/retryCount`。远程服务器是唯一事实来源，Markdown 只是 Codex 上下文，不直接作为无确认的写操作来源。

- [ ] **Step 4: 实现 daemon 前台进程**

增加：

```bash
vibeplan daemon --foreground
```

daemon 启动时校验项目配置和 session，先同步任务，再每 2 秒处理 outbox；使用 `/projects/:projectId/events` 的 SSE 接收远程任务事件，断线后指数退避并重新连接。日志写入 `.vibe/daemon.log`，进程退出不删除 outbox。

- [ ] **Step 5: 运行同步测试并提交**

运行：`pnpm vitest run apps/cli/src/cli.test.ts --no-file-parallelism && pnpm --filter @vibeplan/cli build`

```bash
git add apps/cli packages/templates
git commit -m "feat: add local task mirror and sync daemon"
```

## 任务 4：增加 Codex 项目规则和可安装 Skill

**Files:**
- Modify: `packages/templates/src/index.ts`
- Create: `packages/templates/src/codex-skill.ts`
- Create: `packages/templates/src/index.test.ts`
- Modify: `apps/cli/src/commands/init.ts`
- Create: `apps/cli/src/commands/install-codex.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `README.md`

- [ ] **Step 1: 写模板测试**

断言生成的规则包含以下协议：用户说“加入 Vibe Plan”时先整理字段并询问确认；出现 `vibe://task/` 或任务 UUID 时调用 `vibeplan task:show`；开始修改前调用 `vibeplan task:start --version`；完成后运行测试和 `vibeplan task:report`；没有用户确认不得远程创建或开始任务。

- [ ] **Step 2: 实现项目模板**

更新 `agentsInstructions()` 和 `projectInstructions()`，使用实际冒号命令，并明确创建任务必须具备标题、类型、状态、时间、工时、描述和验收标准。`vibeplan init` 继续生成项目级规则，但不得把用户已有的 `AGENTS.md` 静默覆盖；存在时先备份到 `.vibe.backup/<timestamp>/`。

- [ ] **Step 3: 实现用户级 Skill 安装**

`vibeplan install-codex` 将 `codexSkillInstructions()` 写入 `${CODEX_HOME:-$HOME/.codex}/skills/vibe-plan/SKILL.md`，先比较内容哈希，重复安装不覆盖用户修改。输出安装路径和重启 Codex 的提示。

- [ ] **Step 4: 测试并提交**

运行：`pnpm vitest run packages/templates/src/index.test.ts apps/cli/src/cli.test.ts --no-file-parallelism && pnpm --filter @vibeplan/templates build && pnpm --filter @vibeplan/cli build`

```bash
git add packages/templates apps/cli README.md
git commit -m "feat: add Codex Vibe Plan workflow instructions"
```

## 任务 5：完善任务执行报告和验收闭环

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/work-items/service.ts`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/modules/work-items/reports.test.ts`
- Modify: `apps/cli/src/commands/task.ts`
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx`
- Modify: `apps/web/src/app.test.tsx`

- [ ] **Step 1: 写报告 API 测试**

增加 `POST /work-items/:id/report` 测试，payload 为：

```json
{
  "summary": "完成任务同步",
  "changedFiles": ["apps/cli/src/commands/task.ts"],
  "tests": [{"command": "pnpm test", "result": "passed"}],
  "commit": "abc1234"
}
```

断言报告产生 `task_events.action = report`，并且没有验收记录时不能直接把任务设为 `done`。

- [ ] **Step 2: 实现报告和验收状态机**

报告保存为事件 payload，`task:report` 上传结构化字段并将任务置为 `in_review`。新增 `POST /work-items/:id/accept`，只有项目贡献者可以提交验收结果；通过后以 `acceptanceRecorded: true` 更新为 `done`，拒绝则回到 `in_progress` 并记录原因。

- [ ] **Step 3: 扩展 Web 详情页**

在任务详情页显示最新报告、改动文件、测试命令/结果、commit 和验收记录；通过 SSE 自动刷新。Web 不允许在没有验收结果时显示“已完成”。

- [ ] **Step 4: 测试并提交**

运行：`DATABASE_URL=postgres://$(whoami)@localhost:55433/vibe_plan_test pnpm test`

```bash
git add apps/api apps/cli apps/web
git commit -m "feat: close task execution and acceptance loop"
```

## 任务 6：修复本地开发启动和生产部署

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/modules/mail/mailer.ts`
- Create: `apps/api/src/modules/mail/smtp-mailer.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `docker/web.Dockerfile`
- Create: `docker/nginx.conf`
- Modify: `docker-compose.prod.yml`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: 添加本地环境加载**

让 API 开发脚本使用 Node 22 的 `--env-file=.env`（或等价的显式加载方式），并保留测试命令通过 `DATABASE_URL` 覆盖。启动后 `curl http://localhost:4000/health` 必须返回 `{"status":"ok"}`。

- [ ] **Step 2: 实现 SMTP 邮件发送**

增加 SMTP Mailer，生产环境存在 `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM` 时发送验证码；没有配置时仅允许开发环境使用 ConsoleMailer，生产启动直接报配置错误。增加 SMTP 失败测试，确保注册不会伪造成功。

- [ ] **Step 3: 修复生产 Web 到 API 的地址**

通过 `VITE_API_URL` 在 Web 构建时注入 API 地址，或让 Nginx 将 `/api/` 反向代理到 API 并让浏览器使用同源路径。生产容器中不得保留 `http://localhost:4000` 的默认请求地址。

- [ ] **Step 4: 增加 Compose 健康检查和迁移入口**

API 等待数据库健康后运行迁移；Web/API/DB 增加 healthcheck、持久化卷和日志说明。生产部署必须使用随机 `AUTH_ACCESS_SECRET`、TLS 反向代理、数据库备份和 SMTP。

- [ ] **Step 5: 验证部署**

本地运行：

```bash
pnpm install
docker compose up -d db
set -a; source .env; set +a
pnpm --filter @vibeplan/api db:migrate
pnpm dev
```

生产运行：

```bash
docker compose -f docker-compose.prod.yml up -d --build
curl https://YOUR_DOMAIN/health
```

```bash
git add apps/api apps/web docker .env.example README.md
git commit -m "chore: harden local and production runtime"
```

## 任务 7：端到端验收和文档

**Files:**
- Modify: `README.md`
- Create: `docs/vibe-plan-codex-workflow.md`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/cli/src/cli.test.ts`

- [ ] **Step 1: 编写端到端验收清单**

覆盖：注册/登录、组织/团队/项目权限、创建标准任务、复制任务 ID、`task:show`、用户确认后 `task:start`、本地代码修改、测试报告、验收、Web 实时更新、断网 outbox 重试、版本冲突提示。

- [ ] **Step 2: 运行完整验证**

```bash
DATABASE_URL=postgres://$(whoami)@localhost:55433/vibe_plan_test pnpm test
pnpm lint
pnpm build
git diff --check
```

预期：所有测试通过，CLI/Web/API 构建成功，无 diff 空白错误。

- [ ] **Step 3: 用真实本地项目演练**

```bash
node apps/cli/dist/index.js login --server http://localhost:4000
node apps/cli/dist/index.js init --project-id PROJECT_ID
node apps/cli/dist/index.js install-codex
node apps/cli/dist/index.js daemon --foreground
```

在同一项目的 Codex 会话中输入“把上面的任务加入 Vibe Plan”，确认任务 ID 返回；再输入“实现任务 `<id>`”，确认 Codex 先读取任务、等待确认、开始任务、运行测试并提交报告。

- [ ] **Step 4: 提交文档**

```bash
git add README.md docs/vibe-plan-codex-workflow.md apps/web/src apps/api/src apps/cli/src
git commit -m "docs: document Codex Vibe Plan workflow"
```

## 验收完成标准

- 用户无需打开 Web 页面即可在 Codex 对话中创建任务，但必须经过一次明确确认。
- 创建任务缺少标题、类型、状态、时间、工时、描述或验收标准时，系统拒绝请求或要求补齐。
- 复制任务 ID 后，Codex 能读取任务详情并在用户确认后开始执行。
- 任务状态、版本、报告和验收结果可以从本地同步到云端；断网时不丢失更新。
- Web 页面能通过 SSE 快速看到其他用户或 daemon 的任务变更。
- 服务器不执行本地代码；所有代码、测试和 Git 操作仍由用户本地 Codex 完成。
- 新用户可以按 README 在本地启动；生产部署不会把 API 请求错误发送到用户自己的 `localhost`，并能真实发送邮箱验证码。
