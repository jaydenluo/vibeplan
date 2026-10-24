# 任务详细计划 Markdown

## 目标

为每个 Vibe Plan 任务保存一份结构化的 Markdown 执行计划，并在网页端只读展示；daemon 同步时将正文镜像到本地 `.vibe/tasks/<TASK_ID>.plan.md`，供 Codex 在后续会话读取。

## 范围

- 使用现有 `work_items.plan_markdown` 字段保存正文，不新增独立计划表。
- API 在任务创建、更新和读取时传递 `planMarkdown`，沿用现有项目权限和版本冲突控制。
- 任务镜像拆分为普通任务 Markdown 和 `.plan.md` 正文文件，避免破坏旧 front matter 解析。
- Web 任务详情只读显示 Markdown，不允许网页直接改写计划正文。
- CLI 提供 `task:plan` 上传计划；daemon 拉取云端正文并写本地镜像。

## 实施步骤

1. 确认数据库和 API schema 支持可空的 `planMarkdown`，并保持版本化更新。
2. 在 CLI 执行 `task:plan`，通过绑定项目、登录身份和任务版本校验后提交正文。
3. 在同步镜像层写入 `<task-id>.plan.md`；没有正文时写入明确的占位内容。
4. 在网页任务详情中只读渲染正文，并保留任务普通字段与验收信息。
5. 编写 API、CLI、同步和 Web 测试，覆盖正文保存、更新、空计划和镜像生成。

## 相关文件

- `apps/api/src/db/schema.ts`
- `apps/api/src/db/migrate.ts`
- `apps/api/src/app.ts`
- `apps/api/src/modules/work-items/service.ts`
- `apps/cli/src/commands/execution.ts`
- `apps/cli/src/sync/task-mirror.ts`
- `apps/web/src/workspace/ProjectManagementPage.tsx`
- `apps/web/src/workspace/WorkItemCreateForm.tsx`

## 风险与边界

- `.plan.md` 是云端正文的镜像，直接编辑不会上传，后续同步可能覆盖本地修改。
- Markdown 按纯文本只读显示，不执行 HTML 或脚本。
- 计划正文不扩大任务授权范围，状态、验收和版本仍由 API 控制。
- 没有计划正文的旧任务继续可用，并显示占位提示。

## 测试方案

- API：创建、更新、读取计划正文，并验证版本冲突和权限。
- CLI：`task:plan` 参数校验、绑定校验和离线队列行为。
- 同步：正文写入独立 `.plan.md`，空正文和重复同步不破坏文件。
- Web：任务详情显示计划正文且没有编辑控件。

## 验收对应

- 目标、范围、步骤、风险和测试方案：本计划正文及任务详情可读。
- 预计改动模块/文件与验收清单：本计划的相关文件和验收对应章节。
- 网页只读查看：任务详情计划区域。
- 本地镜像：daemon 同步生成 `.vibe/tasks/<TASK_ID>.plan.md`。
