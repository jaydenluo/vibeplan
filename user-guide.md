# Vibe Plan 使用指南

Vibe Plan 的网页端管理组织、团队、项目和任务；本地 `vibeplan` CLI 负责项目绑定、任务同步和编码助手协作。

## 使用许可

本项目允许个人和企业免费使用、修改，并在个人环境或企业内部私有化部署。禁止将本项目或其修改版本用于商业运营、商业销售、商业托管、商业 SaaS 或收费代运维。完整条款见根目录 [LICENSE](LICENSE)；超出许可范围的商业使用需要单独取得书面授权。

## 1. 安装与绑定项目

环境要求：Node.js 22 或更高版本。

```bash
npm install --global @vibeplan/cli@latest
vibeplan --version
```

先在 [项目管理](https://vibeplan.szxinjin.cn/projects) 创建或选择云端项目，再进入对应的本地 Git 项目根目录：

```bash
vibeplan login
vibeplan init --project-id PROJECT_ID
```

`login` 会显示登录页面和一次性设备码，并提示按回车自动打开浏览器；也可以复制网址手动访问。设备码 10 分钟内有效。登录凭据保存在操作系统 Keychain，不会写入仓库。`init` 会创建或更新 `.vibe/project.yaml`、`.vibe/tasks/`、`.vibe/cache/`、`.vibe/instructions.md` 和 `AGENTS.md`。

默认 access token 有效 30 分钟，refresh 会话有效 90 天；每次成功刷新都会重新获得 90 天。服务器通过 `AUTH_ACCESS_TOKEN_TTL` 和 `AUTH_REFRESH_TOKEN_TTL` 控制实际时长。密码重置、退出登录、服务器清理会话或本机 Keychain 条目被删除后，需要重新登录。

绑定其他项目时必须明确执行 `vibeplan init --project-id PROJECT_ID --force`；旧目录会先备份。

## 2. 安装编码助手规则

Codex：

```bash
vibeplan install-codex
vibeplan install-codex --force
```

Claude Code：

```bash
vibeplan install-claude
vibeplan install-claude --force
```

升级 CLI 后重新执行对应命令；如果需要覆盖已有的自定义规则，使用 `--force`。命令只更新 Vibe Plan 管理区块，区块外内容会保留。完成后重启编码助手。

## 3. 启动同步：`vibeplan start`

`start` 必须在已经执行过 `vibeplan init` 的项目根目录运行。它会检查项目绑定、登录状态和服务端连通性，然后启动当前项目的后台同步进程。

```bash
cd /path/to/your/git-project
vibeplan start
```

首次运行或登录过期时，交互式终端会显示：

```text
[1] 现在登录  [2] 取消
```

选择 `1` 完成设备授权后，`start` 会自动继续启动；选择 `2` 则退出。非交互式脚本不会等待输入，需要先执行 `vibeplan login`。如果当前目录没有绑定项目，先执行：

```bash
vibeplan init --project-id PROJECT_ID
```

启动成功后，交互式终端会显示最近和实时同步日志。按 `Ctrl-C` 只退出日志查看，后台仍继续运行；关闭终端也不会停止后台。重复运行 `vibeplan start` 会复用当前项目已有的后台，不会启动第二个。

常用管理命令：

```bash
vibeplan status          # 查看后台是否运行、PID、登录和同步摘要
vibeplan logs            # 查看最近日志后退出
vibeplan logs --follow   # 重新进入实时日志，Ctrl-C 只退出查看
vibeplan stop            # 停止当前目录对应的后台
```

`start` 只管理当前工作目录。电脑上有多个项目时，需要分别进入每个项目目录执行一次 `vibeplan start`；`status`、`logs` 和 `stop` 也只作用于当前目录。调试同步引擎时使用前台模式：

```bash
vibeplan daemon --foreground
```

前台模式的 `Ctrl-C` 会真正停止同步。后台同步任务镜像到 `.vibe/tasks/`，把离线变更暂存到 `.vibe/outbox/`，并写入 `.vibe/daemon.log`；它不会执行代码。旧版 CLI 没有 `logs` 时可使用 `tail -f .vibe/daemon.log`。

如果 `status` 显示存在无法验证的旧锁，先确认旧进程已经退出，再重新运行 `vibeplan start`；不要在进程仍可能运行时删除 `.vibe/daemon.lock`。

## 4. 创建、查看和同步任务

网页端适合创建和编辑任务。CLI 需要在已绑定目录中运行：

```bash
vibeplan task:list
vibeplan task:show TASK_ID
vibeplan task:sync
```

也可以使用 CLI 创建任务：

```bash
vibeplan task:create \
  --title "任务标题" --type feature --status backlog --priority P2 \
  --estimate 3 --description "任务描述" \
  --acceptance "验收标准一" --acceptance "验收标准二"
```

类型包括 `feature`、`bug`、`improvement`、`refactor`、`documentation`、`research`、`chore`。状态包括 `backlog`、`ready`、`in_progress`、`blocked`、`in_review`、`done`、`cancelled`。

在 Codex 或 Claude Code 中说“把上面的任务加入 Vibe Plan”，助手会先展示摘要，得到确认后才创建任务。

### 任务记录建议

不必为每个小功能单独创建任务。推荐“任务管目标，记录管细节”：

- **独立目标建一个任务**：例如“完善个人订阅”，把免费额度、个人版套餐和账单入口放在同一个任务里，用验收清单区分具体结果。
- **小改动记执行记录**：文案、按钮位置、错误提示和同范围修复，追加到相关任务，不必重复建任务。
- **临时杂项统一收纳**：没有合适归属的工作，可以放进“本周维护”任务；每条记录写清改了什么、验证结果是什么。

普通小任务不必强制编写很长的计划。开发过程中记录关键改动和测试结果，交付时统一提交报告，最后由负责人完成验收。这样既能保留完整记录，也能避免任务列表被细碎事项淹没。

## 5. 更新任务

网页任务详情中的编辑功能可以修改标题、描述、类型、优先级、截止日期、预估天数、完成度、验收标准和详细计划。

CLI 更新前先读取当前版本：

```bash
vibeplan task:show TASK_ID
```

把修改字段写入 `patch.json`，再执行：

```json
{
  "title": "更新后的标题",
  "priority": "P1",
  "progress": 40,
  "executionNote": "已完成接口设计"
}
```

```bash
vibeplan task:update TASK_ID --task-version VERSION --file patch.json
```

状态修改必须同时提供 `executionNote` 或 `changeReason`。`task:update` 不能直接把任务改成 `in_review` 或 `done`：前者由报告产生，后者由验收产生。版本冲突时重新执行 `task:show` 或 `task:context`，确认云端最新内容后再提交。

## 6. 取消和删除任务

- **取消**：保留任务和历史记录，将状态改为 `cancelled`。推荐在网页编辑任务时选择“已取消”。
- **删除**：从项目中永久删除任务。网页任务详情中的删除操作需要项目管理权限和当前任务版本；删除父任务时，子任务也会一起删除。删除不可恢复。

当前 CLI 没有 `task:delete` 命令，也不能通过 `task:update` 直接设置 `cancelled`。需要取消或删除时使用网页端；任务只是暂时不做时，优先取消而不是删除。

## 7. 执行、报告和验收

```bash
vibeplan task:show TASK_ID
vibeplan task:start TASK_ID --task-version VERSION
```

执行中更新进度：

```bash
vibeplan task:progress TASK_ID --task-version VERSION --progress 40 --stage testing --summary "正在运行测试"
```

完成后提交报告：

```bash
vibeplan task:report TASK_ID --task-version VERSION --summary "实现完成，测试通过"
```

报告成功后进入 `in_review`。审核通过后：

```bash
vibeplan task:accept TASK_ID --task-version VERSION --decision approved
```

审核退回时使用 `--decision rejected --comment "修改意见"`，在同一个任务中修复后重新测试和提交报告。任务计划可以单独上传：

```bash
vibeplan task:plan TASK_ID --task-version VERSION --file plan.md
```

## 8. 工时记录

```bash
vibeplan task:log TASK_ID --hours 2 --content "完成接口实现" --date 2026-10-25
vibeplan task:log-edit TASK_ID LOG_ID --log-version VERSION --reason "修正时长" --hours 1.5
vibeplan task:log-withdraw TASK_ID LOG_ID --log-version VERSION --reason "重复记录"
```

## 9. 批量执行计划

批量执行只在本地运行，网页不会远程执行代码：

```bash
vibeplan plan:prepare --task TASK_UUID --check '["pnpm","test"]'
vibeplan plan:run --file .vibe/batch-plan.json --approve
vibeplan plan:status --file .vibe/batch-plan.json
```

中断后先查看状态和日志，确认原因后使用 `plan:run --resume`；任务范围变化时重新准备清单。

## 10. 常见问题

| 问题 | 处理 |
| --- | --- |
| 当前目录未绑定 | 先在网页创建或选择项目，再执行 `vibeplan init --project-id PROJECT_ID` |
| `Not logged in.` | 执行 `vibeplan login`，然后重新运行原命令或 `vibeplan start` |
| 任务版本冲突 | 重新执行 `vibeplan task:show TASK_ID`，使用最新 `version` |
| 找不到同步日志 | 执行 `vibeplan logs`，旧版使用 `tail -f .vibe/daemon.log` |
| 后台重复运行 | 在当前项目目录执行 `vibeplan status`，确认后执行 `vibeplan stop` |
| 删除后本地仍显示 | 执行 `vibeplan task:sync`，检查 `.vibe/daemon.log` |

任务镜像是云端数据的本地副本，直接编辑 `.vibe/tasks/*.md` 不会更新云端，后续同步可能覆盖本地修改。请使用网页或 CLI 修改任务。

更多执行规则见 [docs/task-execution.md](docs/task-execution.md)，计费见 [docs/billing.md](docs/billing.md)，平台管理见 [docs/admin-console.md](docs/admin-console.md)。
