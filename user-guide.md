# Vibe Plan 使用指南

Vibe Plan 的网页端管理组织、团队、项目和任务；本地 `vibeplan` CLI 负责项目绑定、任务同步和编码助手协作。

## 快速上手

1. 注册并登录 Vibe Plan，在个人菜单中创建或选择组织，再创建团队和项目。
2. 进入项目，复制项目提供的绑定命令，在本地 Git 项目根目录安装 CLI、登录并绑定。
3. 为 Codex 或 Claude Code 安装协作规则，执行 `vibeplan start` 启动后台同步。
4. 向 AI 说明需求，让它把确认后的目标和验收标准加入 Vibe Plan，再授权它开始实现。
5. 在任务详情查看计划、进度和执行报告；任务进入“待审核”后逐项验收，批准完成或写明原因退回。

![Vibe Plan 协作流程示意：规划任务、授权执行、提交报告、人工验收](/guide/images/workflow.svg)

上图为协作流程示意，不是产品界面截图。AI 提交报告后仍需人工验收；退回修改时，在原任务内继续修复和验证。

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

在[项目管理页面](/projects)，点击对应项目卡片右上角的复制按钮，即可复制包含完整项目 ID 的初始化命令，粘贴到本地项目根目录运行。

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

## 在 Codex 聊天中使用：完整示例

完成前面的登录、项目绑定、安装 Codex 规则和启动同步后，在 Codex 中打开同一个本地项目，即可用自然语言协作。以下 `text` 代码块是可以复制到 **Codex 聊天框**的话术，终端命令仍放在 `bash` 代码块中。`TASK_ID` 需要替换成实际创建的任务 ID。

下面以“优化登录表单体验”为例，展示从需求讨论到人工验收的过程。这是一组示例话术，不代表这些任务已在你的项目中创建或执行。

### 示例一：先讨论需求和方案

在 Codex 聊天中发送：

```text
我想优化这个项目的登录表单体验：
1. 邮箱或密码为空时，在对应字段下提示，不发送登录请求。
2. 提交期间显示“登录中”，防止重复提交。
3. 登录失败时显示明确原因，保留已输入的邮箱。
4. 在手机上能正常显示和操作。

请先查看现有实现，给出修改方案和验收标准，等我确认后再改代码。
```

你可以继续补充界面要求、错误提示文案和需要兼容的屏幕尺寸。这个阶段先把目标和验收方式说清楚。

### 示例二：把确认后的需求加入 Vibe Plan

确认方案后，在同一段对话中发送：

```text
把上面确认的需求加入 Vibe Plan，标题为“优化登录表单体验”。
优先级 P2，预估 2 天，目前没有指定截止日期。
请先展示任务描述和验收标准，等我确认后创建。
```

Codex 应先展示任务摘要。核对无误后回复：

```text
确认，请创建这条任务。
```

创建成功后，保留返回的任务 ID，并在[项目管理页面](/projects)打开对应项目查看。没有指定排期时，任务创建阶段不填截止日期，首次开始时再根据预估计算。

### 示例三：授权开始实现，并维护进度

拿到任务 ID 后发送：

```text
请开始实现 Vibe Plan 任务 TASK_ID。
先读取最新任务、验收标准和已有计划，在实现过程中维护计划、进度和阻塞说明。
完成后运行项目相关检查，提交实际改动文件和真实测试结果，供我验收。
```

Codex 会在当前项目中开展已授权的工作，并按规则维护任务记录。你可以在网页任务详情中查看计划、进度和执行报告。同一任务范围内的日常进度维护，不需要反复授权开始。

### 示例四：随时查看进展

```text
帮我查看 Vibe Plan 任务 TASK_ID 的最新进度。
已经完成了什么？还有哪些未完成项？有没有阻塞？下一步是什么？
```

这是查询进度，不表示把任务直接改为已完成。AI 报告的完成情况和测试结果，可以作为你验收时的依据。

### 示例五：换一段聊天后继续同一任务

在同一个本地项目中打开新的 Codex 对话，发送：

```text
继续实现 Vibe Plan 任务 TASK_ID。
先读取任务上下文、详细计划、最近进展和现有代码改动，从上次未完成的地方继续。
保留已有修改，并维护这条任务的计划、进度和验证结果。
```

新的聊天需要读取已有任务记录才能接上工作。更换电脑时，还需要先取得对应代码和未提交改动；Vibe Plan 同步任务记录，不同步整个代码仓库。

### 示例六：验收发现问题后，在原任务修复

任务成功提交执行报告后会进入“待审核”。你在网页核对验收项，发现问题时填写原因并退回，例如“320px 宽度下登录按钮超出容器”。然后对 Codex 说：

```text
任务 TASK_ID 已退回，请读取本轮验收意见并修复。
重点检查 320px 宽度下登录按钮超出容器的问题。
在原任务中补充修复记录，重新验证后提交新的执行报告，供我再次验收。
```

修复后需要重新提交报告、重新验收。待审核或进度显示 100%，都不等于已经通过人工验收；最终由有权限的审核人确认完成。

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

### 一个账号可以在多部电脑同时登录吗？

可以。同一个账号可以同时在两台或多台电脑登录。每台电脑都会获得独立的登录会话，互不挤下线；在其中一台电脑退出登录，不会影响其他电脑。多台电脑使用同一账号时，组织成员席位仍只计算 1 名成员，不会重复占用套餐席位。

密码重置会撤销该账号现有的刷新会话，其他电脑上的登录状态会在下一次续期时失效，需要重新登录。当前系统不限制同时登录的电脑数量，也暂未提供查看登录设备或远程退出指定设备的页面。

### 换电脑后，是否需要重新安装和绑定？

新电脑需要安装 CLI 并执行 `vibeplan login`。取得代码后，在该电脑的本地项目目录检查绑定；尚未绑定时，复制[项目管理页面](/projects)对应项目的初始化命令执行，再安装编码助手规则、重启助手并运行 `vibeplan start`。

任务同步不会代替 Git，也不会把一台电脑上的代码或未提交修改传到另一台电脑。继续开发前，需要另行取得对应代码改动。

### 关闭终端或按 Ctrl-C，会停止后台同步吗？

使用 `vibeplan start` 时，按 `Ctrl-C` 只退出日志查看，关闭终端后后台仍运行。再次查看日志可运行 `vibeplan logs --follow`，停止后台请运行 `vibeplan stop`。

只有使用 `vibeplan daemon --foreground` 前台调试时，`Ctrl-C` 才会真正停止同步进程。

### 启动同步后，AI 会自己开始写代码吗？

不会。后台只同步任务记录，不会读取任意 Codex 对话或自动执行开发。需要在 Codex 聊天中明确告诉助手要实现哪条任务，例如“请开始实现 Vibe Plan 任务 TASK_ID”。

### Codex 没有按 Vibe Plan 流程记录任务，怎么办？

确认 Codex 打开的是已绑定的本地项目目录，并且已运行 `vibeplan install-codex`、重启 Codex。项目根目录应存在 `AGENTS.md` 和 `.vibe/instructions.md`。

然后在聊天中明确提供任务 ID，并要求维护任务计划、进度和真实执行报告。CLI 升级后，按前面的说明更新对应助手规则。

### 任务进度是 100%，为什么还没有“已完成”？

“待审核”阶段可以显示 100%，表示执行结果已提交供检查。最终完成还需要有权限的审核人核对本轮验收项并批准；执行报告和进度数字都不能代替人工验收。

### 为什么有些任务不能直接验收？

正常验收需要任务处于“待审核”（`in_review`），并且具备本轮成功执行报告。“待规划”“待开始”“进行中”或“已阻塞”的任务，应先完成执行与验证，再提交成功报告。

验收操作还受审核权限和必需验收项结果约束。请根据页面提示处理具体条件，不要只修改进度数字来代替报告和验收。

### 验收退回后，要重新创建任务吗？

同一目标范围内的问题，继续在原任务修复即可。让 Codex 读取本轮退回原因，补充修复记录、重新测试并提交新的执行报告，再进行新一轮验收。独立的新需求可以另建任务。

### 可以直接编辑 .vibe/tasks 中的文件来更新任务吗？

不可以。任务镜像是云端数据的本地副本，直接编辑 `.vibe/tasks/*.md` 不会更新云端，后续同步可能覆盖本地修改。请使用网页、CLI 或让 Codex 按流程更新任务。

### “预估 2 天”和工时记录有什么区别？

预估使用“天”，用于任务规划；实际工时使用“小时”，按真实工作记录。两者没有默认换算关系。没有指定排期的任务，首次开始时会根据预估计算截止日期，你可以在网页中调整。

### 本地修改教程后，为什么线上没有变化？

教程正文来自仓库根目录 `user-guide.md`。开发环境保存后更新预览；线上需要重新构建并发布 Web，才会展示新内容。修改本地文档不会直接更新已经部署的网站。

### 登录、绑定和同步报错时，如何排查？

| 问题 | 处理 |
| --- | --- |
| 当前目录未绑定 | 先在网页创建或选择项目，再执行 `vibeplan init --project-id PROJECT_ID` |
| `Not logged in.` | 执行 `vibeplan login`，然后重新运行原命令或 `vibeplan start` |
| 任务版本冲突 | 重新执行 `vibeplan task:show TASK_ID`，使用最新 `version` |
| 找不到同步日志 | 执行 `vibeplan logs`，旧版使用 `tail -f .vibe/daemon.log` |
| 不确定后台是否运行 | 在当前项目目录执行 `vibeplan status`；重复执行 `vibeplan start` 会复用已有后台 |
| 网页和本地任务暂时不一致 | 检查 `vibeplan status`、`vibeplan logs` 中的连接、登录和同步情况；后台未运行时使用 `vibeplan start`，或手动执行 `vibeplan task:sync` |
| 换了项目目录后没有同步 | 每个已绑定的本地项目需要分别启动自己的后台，在对应目录执行 `vibeplan start` |
| 升级 CLI 后仍表现得像旧版 | 更新助手规则并重启助手；在项目目录执行 `vibeplan stop`，再运行 `vibeplan start` 重启旧后台 |

更多执行规则见 [docs/task-execution.md](docs/task-execution.md)，计费见 [docs/billing.md](docs/billing.md)，平台管理见 [docs/admin-console.md](docs/admin-console.md)。

## 维护这份教程

网页左侧菜单的“使用教程”与本文件共用一份内容。维护者直接编辑仓库根目录 `user-guide.md`：开发环境保存后更新预览，线上版本需要重新构建和发布后更新。

配图放在 `apps/web/public/guide/images/`，Markdown 使用 `![图片说明](/guide/images/文件名.png)` 引用。请填写有意义的图片说明，不要将账号、令牌或真实客户数据放入配图。二、三级标题会自动生成章节目录；代码围栏可标注 `bash`、`json` 等语言，网页提供高亮和复制。
