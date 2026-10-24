# Vibe Plan 用户使用教程

新版任务闭环：[执行计划、阶段回报、失败恢复、验收与项目分析（中英文）](task-execution.md)。

AI 日常维护：运行 `vibeplan start` 后，让 Codex 或 Claude Code “实现/继续任务 TASK_ID，并维护计划、进度、阻塞和修复报告”。授权范围内由 AI 读取 `task:context` 并执行字段、状态和证据更新，用户负责最终验收。新命令、Git 证据范围和升级方法见上方中英文说明。后台负责同步，不会自主执行开发。

AI daily maintenance: Start synchronization with `vibeplan start`, then ask Codex or Claude Code to implement/continue TASK_ID and maintain its plan, progress, blockers and repair reports. The AI reads `task:context` and performs scoped updates; an authorized reviewer approves completion. See the bilingual workflow linked above for commands, Git evidence boundaries and upgrades. The daemon synchronizes data without independently executing development.

## 快速开始

首次使用需要 Node.js 22 或以上版本、Vibe Plan 账号，以及有访问权限的云端项目。

1. 打开 [Vibe Plan 项目管理](https://vibeplan.szxinjin.cn/projects)，登录后创建或选择项目，复制项目卡片上的绑定命令。
2. 安装 CLI，并查看已安装版本和可用命令：

   ```bash
   npm install --global @vibeplan/cli@latest
   vibeplan --version
   vibeplan --help
   ```

3. 在终端进入对应的本地 Git 项目根目录，先登录，再运行复制的绑定命令。将 `PROJECT_ID` 替换为卡片里的实际 ID：

   ```bash
   vibeplan login
   vibeplan init --project-id PROJECT_ID
   ```

   登录时打开终端给出的网页，在头像菜单的 CLI 设备授权入口批准设备码，等待终端显示登录成功。
4. 根据使用的编程助手安装项目规则，然后重启助手：

   ```bash
   vibeplan install-codex
   ```

   如果使用 Claude Code，在项目根目录运行：

   ```bash
   vibeplan install-claude
   ```

   该命令创建或更新项目级 `CLAUDE.md`。它只更新 `VIBE PLAN CLAUDE MANAGED START/END` 区块，区块外的自定义规则会保留。已有无标记 `CLAUDE.md` 时默认不覆盖；确认迁移时使用 `vibeplan install-claude --force`，它会先备份旧文件。

5. 在同一个项目根目录启动同步：

   ```bash
   vibeplan start
   ```

   支持实时日志的版本会持续显示输出。看到新的 `Synchronized N task(s).` 表示该轮任务拉取成功；`N` 为任务数，空项目显示 `0` 也正常。按 `Ctrl-C` 退出日志查看后，后台继续同步，再向 Codex 或 Claude Code 说“把上面的任务加入 Vibe Plan”或“请实现 Vibe Plan 任务 TASK_ID”。

如果 `vibeplan --help` 没有 `logs`，当前安装版本尚不支持这套日志命令；可先用 `tail -f .vibe/daemon.log` 查看。安装最新版后仍缺少命令时，用 `command -v vibeplan`（Windows 用 `where vibeplan`）检查是否调用了另一个 Node.js 环境里的旧版本。

## 1. 产品组成

Vibe Plan 分为云端网页、云端 API 和本地 CLI 三部分：

- 云端网页：访问 `https://vibeplan.szxinjin.cn`，管理组织、团队、项目、任务、甘特图和审批。
- 云端 API：保存账号、权限、任务状态、执行报告和验收记录。
- 本地 CLI/daemon：连接编程助手和本地 Git 项目，保存项目绑定、任务 Markdown 镜像和离线同步事件。

本地安装 CLI 后不会自动启动一个新的网页。任务管理网页使用云端域名；本地 daemon 是一个后台终端进程，不提供浏览器页面。

## 2. 安装 CLI

要求 Node.js 22 或更高版本：

```bash
npm install --global @vibeplan/cli
vibeplan --help
```

查看已安装版本：

```bash
vibeplan --version
```

如果使用其他 Vibe Plan 服务器：

```bash
vibeplan login --server https://your-domain.example
```

## 3. 第一次配置

### 登录

```bash
vibeplan login
```

终端会显示可点击的 Vibe Plan 网页地址和一次性设备码。打开该地址登录，在设备授权区域输入设备码并批准。设备码 10 分钟内有效且只能使用一次；过期、关闭终端或批准失败时，重新运行 `vibeplan login` 获取新码。CLI 会把会话保存到操作系统 Keychain，不会写入代码仓库。

服务端默认 access token 有效期为 30 分钟，refresh 会话有效期为 30 天。浏览器和 CLI 在请求遇到 access token 失效时自动刷新；每次成功刷新都重新计算 30 天，因此持续正常使用通常不需要反复登录。超过 refresh 有效期未使用、执行 `vibeplan logout`、凭据被撤销或服务端清除会话时，需要再次登录。自部署服务器可通过 `AUTH_ACCESS_TOKEN_TTL` 和 `AUTH_REFRESH_TOKEN_TTL` 修改时长，实际有效期以服务器配置为准。

已绑定目录执行 `vibeplan start` 时，若未登录或登录过期，交互终端显示 `[1] 现在登录  [2] 取消`。输入 `1` 并批准设备码后，新版 CLI 会自动继续启动；输入 `2` 则退出。首次使用应先登录并绑定项目，因为 `start` 会先检查绑定。其他命令在登录后可能提示重新运行原命令。脚本和 daemon 不等待输入，需要预先完成登录。

同一操作系统用户的会话保存在 Keychain 中，新开终端通常无需重新登录。`vibeplan logout` 会清除本机共享的 CLI 会话，各项目的后台同步可能因此提示未登录。

CLI 使用系统用户级会话锁协调多个终端和项目后台的续期。其他进程已更新凭据时会复用新会话；服务器临时错误、网络中断或异常响应不会清除登录。升级后请重启每个项目的旧后台，避免旧版仍按原来的逻辑处理凭据。

### 绑定项目

云端项目与本地项目绑定是两个不同的动作。需要新建 Vibe Plan 项目时，先打开 [项目管理](https://vibeplan.szxinjin.cn/projects) 创建项目；已有项目时直接在该页面选择项目。然后在项目卡片中复制初始化命令，到对应的本地 Git 项目根目录运行。绑定不会重新创建云端项目。

进入本地 Git 项目目录：

```bash
vibeplan init --project-id PROJECT_ID
```

会生成：

```text
.vibe/project.yaml       项目和服务器绑定信息
.vibe/tasks/              任务 Markdown 镜像
.vibe/cache/              本地缓存
.vibe/instructions.md     项目级 AI 工作流规则
AGENTS.md                 项目代理规则
```

如果目录已经绑定其他项目，命令会拒绝覆盖；确认切换项目时使用 `--force`，旧的 `.vibe` 会先备份。

如果项目中已有 `AGENTS.md`，Vibe Plan 不会覆盖它，而是在文件末尾添加带有 `VIBE PLAN MANAGED START/END` 标记的托管区块。重复运行 `vibeplan init` 只更新这个区块，用户自己的规则保持不变。

当 Codex 或 Claude Code 要创建任务但当前目录未绑定项目时，它不会直接报“无法创建”后结束，而会提示你前往 [项目管理](https://vibeplan.szxinjin.cn/projects) 创建或选择云端项目，再运行 `vibeplan init --project-id PROJECT_ID`。绑定完成后，继续说“把上面的任务加入 Vibe Plan”即可创建任务，无需再次创建项目。

### 安装 Codex Skill

```bash
vibeplan install-codex
```

安装后重启 Codex。之后 Codex 能识别“把上面的任务加入 Vibe Plan”、任务 ID 和任务执行报告流程。

### 安装 Claude Code 项目规则

在本地项目根目录运行：

```bash
vibeplan install-claude
```

然后重启 Claude Code。Claude Code 会读取项目级 `CLAUDE.md`，使用同一套 `vibeplan task:*` 命令维护任务计划、进度、阻塞、执行报告和验收证据。该规则文件不会替代或覆盖用户在托管区块之外写入的内容。

升级规则时重新运行命令即可。若项目中存在没有 Vibe Plan 托管标记的旧 `CLAUDE.md`，命令会停止并提示；确认覆盖前请检查内容，再运行：

```bash
vibeplan install-claude --force
```

命令会先在项目根目录创建带时间戳的 `CLAUDE.md.backup-*` 备份。

### 更新 CLI 和 Codex Skill

升级 CLI 后，重新安装 Vibe Plan 的 Skill，才能让 Codex 使用最新的任务规则：

```bash
npm install --global @vibeplan/cli@latest
vibeplan install-codex --force
```

托管更新只修改 Skill 标记内的模板，保留外部自定义内容。不同的无标记旧 Skill 需明确 `--force`，它先备份并显示路径，再迁移。升级完成后重启 Codex。

CLI 升级不会替换已经运行的 daemon。升级前在每个运行中的项目根目录执行 `vibeplan stop`，升级后逐个运行 `vibeplan start`。已有绑定无需重建；若需要更新项目级 `.vibe/instructions.md` 和 `AGENTS.md` 托管规则，在该项目根目录重新运行原来的 `vibeplan init --project-id PROJECT_ID`。它会刷新 Vibe Plan 项目规则，请先保存你对 `.vibe/instructions.md` 的手工修改。

升级后执行 `vibeplan --version` 和 `vibeplan --help`，确认当前终端调用的版本与命令。云端服务升级、CLI 升级和 Skill 更新是三个独立步骤。

### 启动同步后台

在已绑定的项目目录启动后台同步：

```bash
vibeplan start
```

`start` 会检查项目绑定与登录，并在新启动 daemon 时尝试安装 Codex Skill。Claude Code 项目规则使用 `vibeplan install-claude` 单独安装，不会因为启动 daemon 而修改 `CLAUDE.md`。托管模板更新保留标记外的自定义内容；不同的无标记旧文件会保留，明确使用对应的 `--force` 时先备份并显示路径。安装或升级后重启对应的编程助手。重复执行 `start` 会复用已验证的当前项目进程，不启动第二份。

支持日志跟随的版本在交互终端显示启动时的运行状态和持续新增的同步日志。按 `Ctrl-C` 只退出日志查看；退出查看或关闭终端后，后台通常继续运行。非交互调用启动后直接返回。电脑重启后不会自动启动，需要重新运行 `vibeplan start`。

退出日志查看后，或在另一个进入相同项目根目录的终端中，按需要执行以下命令。每行是独立操作：

| 目的 | 命令 | 行为 |
| --- | --- | --- |
| 查看项目状态 | `vibeplan status` | 显示登录、绑定、任务与同步摘要后返回 |
| 查看最近日志 | `vibeplan logs` | 显示最多最近 20 行后返回 |
| 重新进入实时日志 | `vibeplan logs --follow` | 持续显示新增日志，`Ctrl-C` 退出查看 |
| 停止当前项目同步 | `vibeplan stop` | 停止可验证的当前项目 daemon |

`vibeplan status` 会验证可用的登录会话，并显示服务端、本地项目绑定、daemon、待同步事件、Git 状态和任务摘要。使用 `vibeplan status --verbose` 可额外查看绑定 ID、提交和本地日志时间；使用 `vibeplan status --json` 可供脚本或 Codex 集成读取。命令不会显示 access token、refresh token、密码或其他敏感信息。

`logs` 需出现在 `vibeplan --help` 的命令列表中。旧版本可用下面的方式查看日志，`Ctrl-C` 同样只结束查看：

```bash
tail -f .vibe/daemon.log
```

`status` 显示“运行中”只表示进程存活。确认同步正常，还应检查最近日志是否有新的 `Synchronized N task(s).`，以及是否持续出现认证、网络或版本冲突错误。`logs` 开头显示的状态是查询时的快照。

调试时也可直接以前台方式运行同步引擎。先停止当前项目的后台，再执行：

```bash
vibeplan daemon --foreground
```

两种方式使用同一套同步逻辑：定期同步任务、重试网络中断期间的变更，并写入 `.vibe/daemon.log`。它不会远程执行代码，也不会启动本地网页。`start` 只有在确认旧锁记录的 PID 已退出后才会自动清理旧锁；如果 PID 仍存活但无法验证，先检查旧 daemon，再决定是否清理 `.vibe/daemon.lock`；`stop` 不会向无法验证的进程发送停止信号。

前台 `daemon --foreground` 的 `Ctrl-C` 会停止同步；`start` 或 `logs --follow` 的 `Ctrl-C` 只退出日志查看。

如果实时日志反复显示 `Not logged in.`，请在交互终端重新运行 `vibeplan start` 并完成设备码登录；运行中的后台会在下一轮同步读取新会话。

一台电脑有多个项目时，在项目 A 根目录执行 `vibeplan start`，退出日志查看后进入项目 B 根目录，再执行 `vibeplan start`。每个目录各有一份后台，可以用同一个终端依次启动，也可以使用多个终端。`status`、`logs` 和 `stop` 都以当前目录为准，不会管理其他目录的项目。每个项目应只运行一份 daemon。

## 4. 日常使用

### 组织订阅与成员额度

在团队页面选择组织后，打开“订阅与账单”可以查看当前套餐、成员额度、项目额度和订单记录。只有组织所有者可以购买、续费、升级或安排降级；其他成员可查看套餐状态，但不能管理付款。

个人免费套餐允许组织所有者单独使用，免费组织不能邀请成员。同一所有者旗下所有免费组织合计最多创建 10 个项目。付费套餐按组织计费，项目数量不限，成员数量按组织内不同用户计算，同一用户加入多个团队仍只占一个席位。

付款为支付宝年度主动付款，不会自动扣款。到期后有 7 天宽限期；宽限期结束后项目、任务和成员数据仍可查看，但组织进入只读，不能继续创建或修改。续费付款经支付宝异步通知确认后立即恢复。降级在当前周期结束时生效；若人数高于新额度，现有成员不会被删除，但需要减少成员或升级才能恢复写入和邀请。

完整套餐、服务器支付宝配置和故障排查见 [账单说明](billing.md)。

### 平台管理后台

平台管理后台位于同一个网页应用的 `/admin` 路由，不是独立网站。只有服务器指定的平台管理员登录后，左侧菜单才会显示“管理后台”；普通用户、组织所有者、组织管理员和团队负责人都没有该权限。即使手动打开 `/admin`，服务端仍会拒绝未授权请求。

首个超级管理员由部署人员在服务器 `.env` 设置，邮箱必须已经注册 Vibe Plan 账号。可用英文逗号填写多个邮箱，修改后重启 API 或重新部署才会生效：

```dotenv
PLATFORM_ADMIN_EMAILS=owner@example.com,ops@example.com
```

`super_admin` 可以查看运营数据，并为已注册用户授予或撤销平台管理员；`operator` 只能查看数据，不能管理管理员。组织中的 owner、admin、member 等角色与平台管理员完全分离。为了保留紧急恢复入口，环境变量中的超级管理员不能在网页中撤销；变更该变量时请保留至少一个可访问的邮箱，并将 `.env` 作为服务器机密文件保存。

后台当前提供注册/组织/订阅概览、用户查询、组织套餐与额度查询、支付宝订单/充值记录查询，以及管理员名单管理。所有管理员读取敏感运营列表和权限变更都会写入服务器审计日志；日志不保存密码、会话令牌、支付宝签名或私钥。

一期不支持退款、人工确认付款、人工开通或修改订阅、改价、删除用户、开票或导出全部个人资料。支付是否成功始终以支付宝异步通知验签后的订单状态为准。更完整的部署、安全和权限说明见[平台管理后台说明](admin-console.md)。

网页端用于查看和管理任务：

```text
https://vibeplan.szxinjin.cn
```

Codex 或 Claude Code 在本地项目中修改代码。常用 CLI 命令：

```bash
vibeplan task:sync
vibeplan task:list
vibeplan task:show TASK_ID
vibeplan task:start TASK_ID --version VERSION
vibeplan task:report TASK_ID --version VERSION --summary "完成说明"
vibeplan task:accept TASK_ID --version VERSION --decision approved
```

如果 `vibeplan start` 或 `vibeplan daemon --foreground` 正在运行，`vibeplan task:sync` 不需要手动执行，daemon 会自动同步。`task:sync` 只是需要立即刷新、或没有运行 daemon 时的手动命令。

## 5. 让编程助手实现一个任务

在已绑定且运行同步后台的本地项目根目录中，直接把任务 ID 发给 Codex 或 Claude Code，例如：

```text
请实现 Vibe Plan 任务 TASK_ID
```

两者的执行顺序相同：

1. 执行 `vibeplan task:show TASK_ID`，读取任务详情和验收标准。
2. 把标题、类型、状态、优先级、描述、时间、预估工时和验收标准展示给你。
3. 等你明确确认后，执行 `vibeplan task:start TASK_ID --version VERSION`。
4. 在当前本地 Git 项目中实现任务，只修改相关代码。
5. 运行 `vibeplan check` 和相关测试，收集改动文件、测试结果和 Commit。
6. 执行 `vibeplan task:report TASK_ID --version VERSION --summary "..."`，任务进入待审核。
7. 你确认验收后，再执行 `vibeplan task:accept TASK_ID --version VERSION --decision approved`。

编程助手不会在没有确认的情况下创建、开始或完成云端任务。

推荐直接对 Codex 或 Claude Code 说：

```text
把上面的任务加入 Vibe Plan
```

编程助手会直接整理出标题、类型、状态、优先级、描述、验收标准和可编辑的预估工时，不会因为没有排期、描述或验收标准而反复追问。它展示完整摘要并得到确认后才会创建任务。

没有明确排期时，任务创建时不填写截止日期。首次开始任务时，Vibe Plan 把当天作为开始日，并按预估天数自动计算结束日，例如预估 3 天时当天为第 1 天。之后可在网页任务表单或甘特图中手动调整日期和工时。

## 6. 离线与故障恢复

- `.vibe/outbox/`：服务器暂时不可用时保存待重试事件。
- `.vibe/tasks/`：服务器任务的本地 Markdown 镜像，供编程助手快速读取。
- `.vibe/daemon.log`：同步失败和版本冲突日志。

网络恢复后，daemon 会自动重试。不要把访问令牌或 outbox 内容提交到 Git。

| 现象 | 处理方法 |
| --- | --- |
| 当前目录未绑定 | 在云端创建或选择项目，到对应的本地根目录执行卡片上的 `init` 命令 |
| 日志持续显示 `Not logged in.` | 退出查看，运行 `vibeplan start` 完成登录；也可显式运行 `vibeplan login` 后再次检查日志 |
| 进程运行但没有成功同步 | 查看最近日志；检查登录、网络、服务器地址和当前账号的项目权限 |
| 提示无法验证旧锁 | 确认旧终端的 daemon 已结束；新版会清理记录的 PID 已退出的锁。PID 仍存活时先查明进程，不直接删除锁 |
| 日志持续报告版本冲突 | 读取 `vibeplan task:show TASK_ID` 的最新版本，核对云端变更后再提交；自动重试不会解决冲突 |
| 找不到 `logs` 或升级后仍是旧版本 | 安装 `@latest`，检查 `--version`、`--help` 及命令路径；暂用 `tail -f .vibe/daemon.log` |

本地任务 Markdown 和 `.plan.md` 是云端数据的镜像，手工编辑这些文件不会自动上传，之后同步可能覆盖它们。通过网页或 CLI 支持的操作修改云端任务；daemon 负责拉取镜像和重试 CLI 记录的待同步事件。`vibeplan check` 检查本地绑定与任务文件结构，不验证所有验收项或服务器连接。

## 7. 本地网页说明

当前版本没有本地网页管理模式。这样设计是为了让所有成员看到同一个云端任务状态；本地只保留代码、编程助手上下文和同步缓存。如果未来需要离线管理网页，可以再增加 `vibeplan web`，但它不是当前 CLI 的必要组件。

---

# Vibe Plan User Guide (English)

## Quick start

You need Node.js 22 or newer, a Vibe Plan account, and access to a cloud project.

1. Open [Projects](https://vibeplan.szxinjin.cn/projects), create or select a project, and copy the command from its card.
2. Install and inspect the CLI:

   ```bash
   npm install --global @vibeplan/cli@latest
   vibeplan --version
   vibeplan --help
   ```

3. Enter the matching local Git project root, sign in, and run the copied binding command with the actual project ID:

   ```bash
   vibeplan login
   vibeplan init --project-id PROJECT_ID
   ```

   Open the URL printed by login and approve the device code through the avatar menu's CLI device authorization entry. Wait for the terminal to confirm login.
4. Install instructions for the coding assistant you use, then restart it:

   ```bash
   vibeplan install-codex
   ```

   For Claude Code, run this from the project root instead:

   ```bash
   vibeplan install-claude
   ```

   The command creates or updates the project-level `CLAUDE.md`. It updates only the `VIBE PLAN CLAUDE MANAGED START/END` block and preserves custom rules outside it. An unmarked existing `CLAUDE.md` is not replaced by default; use `vibeplan install-claude --force` only after reviewing it, which creates a backup first.

5. Start synchronization in the same project root:

   ```bash
   vibeplan start
   ```

   Versions with live logs keep displaying output. A new `Synchronized N task(s).` means that pull succeeded; `0` is normal for an empty project. Ctrl-C leaves the log view while synchronization continues. Ask Codex or Claude Code to “Add the task above to Vibe Plan” or “Implement Vibe Plan task TASK_ID”.

If `vibeplan --help` does not list `logs`, use `tail -f .vibe/daemon.log` temporarily. If an upgrade still calls an old version, inspect the executable path with `command -v vibeplan` (`where vibeplan` on Windows); different Node.js installations may have different global CLI versions.

## 1. Product components

Vibe Plan has three parts:

- Web app: `https://vibeplan.szxinjin.cn` for organizations, teams, projects, tasks, Gantt views, and approvals.
- Cloud API: stores accounts, permissions, task state, execution reports, and acceptance records.
- Local CLI/daemon: connects a coding assistant and a local Git project to the server and maintains task mirrors and offline events.

Installing the CLI does not start another web app on the user's computer. The shared task-management UI runs on the server domain. The local daemon is a terminal process, not a browser service.

## 2. Install the CLI

Node.js 22 or newer is required:

```bash
npm install --global @vibeplan/cli
vibeplan --help
```

Show the installed version:

```bash
vibeplan --version
```

For another deployment:

```bash
vibeplan login --server https://your-domain.example
```

## 3. First-time setup

### Sign in

```bash
vibeplan login
```

The terminal prints a clickable Vibe Plan web address and a one-time device code. Open that address, sign in, enter the code in the device approval area, and approve it. A device code is valid for 10 minutes and can be used once. If it expires, the terminal is closed, or approval fails, run `vibeplan login` again to obtain a new code. The CLI stores the session in the operating-system Keychain, never in the repository.

The server defaults to a 30-minute access token and a 30-day refresh session. Expired access tokens are refreshed automatically; each successful refresh restarts the refresh window. Sign in again after the refresh window expires, logout, revocation, or a server-side session reset. Self-hosted servers can change these durations with `AUTH_ACCESS_TOKEN_TTL` and `AUTH_REFRESH_TOKEN_TTL`; actual expiry depends on server configuration.

In a bound project, an interactive `vibeplan start` offers `[1] Log in now  [2] Cancel` when authentication is needed. Choose `1`, approve the device code, and the updated CLI continues startup automatically. Choose `2` to exit. On first use, sign in and bind the project before starting, because `start` checks binding first. Other commands may ask you to rerun the original command after login. Scripts and the daemon never wait for interactive input.

Credentials are shared across terminals for the same operating-system user through Keychain. Opening another terminal normally does not require login. `vibeplan logout` clears this shared CLI session and can interrupt authentication in every project's daemon.

The CLI coordinates refreshes across terminals and project daemons with a user-level session lock, reusing credentials renewed by another process. Temporary server errors, network failures, and malformed responses preserve the session. Restart each project's older daemon after upgrading so it no longer uses the previous credential handling.

### Bind a project

Creating a cloud project and binding a local project are separate actions. To create a Vibe Plan project, first open [Projects](https://vibeplan.szxinjin.cn/projects) and create one; for an existing project, select it there. Copy its initialization command from the project card, then run it in the matching local Git project root. Binding never creates the cloud project again.

Run this inside a local Git project:

```bash
vibeplan init --project-id PROJECT_ID
```

The command creates the `.vibe` files and adds only a marked Vibe Plan block to an existing `AGENTS.md`, preserving your own instructions. If the directory is already bound to another project, the command refuses to overwrite it. Use `--force` only when switching projects; the old `.vibe` directory is backed up first.

When Codex or Claude Code needs to create a task in an unbound directory, it directs you to [Projects](https://vibeplan.szxinjin.cn/projects) to create or select the cloud project, then to run `vibeplan init --project-id PROJECT_ID`. After binding, ask it to add the task again; do not create the cloud project a second time.

### Install the Codex Skill

```bash
vibeplan install-codex
```

Restart Codex after installation. Codex can then recognize requests such as “Add the task above to Vibe Plan”, task IDs, and the task reporting workflow.

### Install Claude Code project instructions

From the local project root, run:

```bash
vibeplan install-claude
```

Restart Claude Code afterward. It reads the project-level `CLAUDE.md` and uses the same `vibeplan task:*` workflow for plans, progress, blockers, execution reports, and acceptance evidence. The command updates only the managed Vibe Plan block and preserves custom content outside it.

To update the rules, run the same command after upgrading the CLI. An existing unmarked `CLAUDE.md` is not replaced by default. Review it first, then explicitly migrate it with:

```bash
vibeplan install-claude --force
```

The old file is backed up as `CLAUDE.md.backup-*` in the project root before replacement.

### Update the CLI and Codex Skill

After upgrading the CLI, reinstall the Vibe Plan Skill so Codex uses the latest task rules:

```bash
npm install --global @vibeplan/cli@latest
vibeplan install-codex --force
```

Managed updates preserve custom text outside the Vibe Plan markers. A differing unmanaged legacy `vibe-plan/SKILL.md` requires explicit `--force`, which creates and announces a backup before migration. Restart Codex after the update.

An upgrade does not replace a daemon that is already running. Before upgrading, run `vibeplan stop` in each active project root; afterwards run `vibeplan start` in each project. Existing bindings remain valid. To refresh project-level `.vibe/instructions.md` and the managed `AGENTS.md` block, rerun the original `vibeplan init --project-id PROJECT_ID`; save manual changes to `.vibe/instructions.md` first because init rewrites those project rules.

Check `vibeplan --version` and `vibeplan --help` after upgrading. Updating the cloud service, the CLI, and the Skill are separate operations.

### Start synchronization

Start background synchronization in each bound project directory:

```bash
vibeplan start
```

`start` checks binding and authentication, and attempts Codex Skill installation when launching a new daemon. Claude Code rules are installed separately with `vibeplan install-claude`; starting the daemon never changes `CLAUDE.md`. A managed file with different custom content is preserved with a warning; review it before using the relevant `--force` command, then restart the corresponding coding assistant. Repeating `start` reuses a verified daemon for this project.

Versions supporting live logs show an initial process status and stream new log output in an interactive terminal. Ctrl-C leaves only the log view; after detaching or closing the terminal, the daemon normally keeps running. Non-interactive calls return after launch. It does not automatically start after a computer reboot; run `vibeplan start` again.

After leaving the log view, or in another terminal at the same project root, use these commands individually:

| Purpose | Command | Behavior |
| --- | --- | --- |
| Inspect the process | `vibeplan status` | Prints process state and returns |
| Read recent output | `vibeplan logs` | Prints up to 20 recent lines and returns |
| Reattach live logs | `vibeplan logs --follow` | Streams new output; Ctrl-C detaches |
| Stop synchronization | `vibeplan stop` | Stops this project's verified daemon |

Use `logs` only if it appears in `vibeplan --help`. For older versions, run:

```bash
tail -f .vibe/daemon.log
```

Ctrl-C also detaches this viewer. A running process is not proof of successful synchronization: check for a new `Synchronized N task(s).` and recurring authentication, network, or version-conflict errors. The status printed at the beginning of `logs` is a snapshot.

For debugging, first stop this project's background daemon, then run the same engine in the foreground:

```bash
vibeplan daemon --foreground
```

Both modes synchronize task metadata, retry events after network failures, and write `.vibe/daemon.log`. They do not execute code remotely or start a local web server. `start` removes a legacy lock automatically only after confirming its recorded PID has exited. If the PID is still alive but cannot be verified, inspect the old daemon before removing `.vibe/daemon.lock`; `stop` will not signal an unverified process.

Ctrl-C stops a foreground `daemon --foreground`; it only detaches a `start` or `logs --follow` log viewer.

If the live log repeatedly says `Not logged in.`, run `vibeplan start` again in an interactive terminal and complete device-code login. The running daemon reads the renewed session on its next sync attempt.

For multiple projects, run `vibeplan start` in project A, detach the viewer, enter project B, and run it again. One terminal can start projects sequentially, or you can use several terminals. Each directory has its own daemon. `status`, `logs`, and `stop` apply to the current directory only. Run one daemon per project.

## 4. Daily workflow

Use the web app for shared task management:

```text
https://vibeplan.szxinjin.cn
```

Codex or Claude Code edits code in the local project. Common CLI commands are:

```bash
vibeplan task:sync
vibeplan task:list
vibeplan task:show TASK_ID
vibeplan task:start TASK_ID --version VERSION
vibeplan task:report TASK_ID --version VERSION --summary "Completion summary"
vibeplan task:accept TASK_ID --version VERSION --decision approved
```

When `vibeplan start` or `vibeplan daemon --foreground` is running, `vibeplan task:sync` is automatic and does not need to be run manually. Use `task:sync` for an immediate refresh or when no daemon is running.

### Platform administration

The platform operations console is an isolated route in the same web app: `/admin`. Its left-navigation item appears only after the server confirms that the signed-in user is a platform administrator. Organization owners, organization administrators, and team leads are not platform administrators. The API checks the role for every `/admin/*` request, so entering the URL directly never bypasses access control.

The deployment operator bootstraps the first super administrator in the server `.env`. Every listed email must already belong to a registered Vibe Plan account. Use a comma-separated list and restart the API or redeploy after changing it:

```dotenv
PLATFORM_ADMIN_EMAILS=owner@example.com,ops@example.com
```

A `super_admin` can view operations data and grant or revoke platform roles for existing users. An `operator` is read-only and cannot change administrator access. These roles are separate from organization roles. Environment-bootstrap super administrators cannot be revoked in the browser; keep at least one recoverable email in the environment variable and protect the server `.env` as a secret.

The console currently provides overview metrics, user lookup, organization entitlement lookup, Alipay order/recharge records, and administrator management. Reads of sensitive operations lists and every administrator-role change are written to the server audit log. Audit metadata never includes password hashes, session tokens, Alipay signatures, or private keys.

This first release intentionally excludes refunds, manual payment confirmation, manual subscription activation or editing, price changes, user deletion, invoices, and bulk personal-data exports. Payment success is determined only by the verified Alipay asynchronous notification. See the [platform admin console guide](admin-console.md) for deployment and security details.

## 5. Ask a coding assistant to implement a task

In the local project directory, send Codex or Claude Code a task ID:

```text
Implement Vibe Plan task TASK_ID
```

Both assistants follow this sequence:

1. Run `vibeplan task:show TASK_ID` and read the task and acceptance criteria.
2. Show the title, type, status, priority, description, dates, estimate, and acceptance criteria.
3. After your explicit confirmation, run `vibeplan task:start TASK_ID --version VERSION`.
4. Implement the task in the local Git project and change only relevant files.
5. Run `vibeplan check` and the relevant tests, collecting changed files, test results, and the current commit.
6. Run `vibeplan task:report TASK_ID --version VERSION --summary "..."`; the task enters review.
7. After you accept the work, run `vibeplan task:accept TASK_ID --version VERSION --decision approved`.

The coding assistant never creates, starts, or completes a remote task without explicit confirmation.

Recommended request for either assistant:

```text
Add the task above to Vibe Plan
```

The coding assistant directly drafts a title, type, status, priority, description, acceptance criteria, and an editable estimate. It does not repeatedly ask for missing planning fields. It shows the complete summary and waits for confirmation before creating the task.

When no schedule is specified, the task is created without a due date. On its first start, Vibe Plan uses that day as the start date and calculates the end date from the estimate; for a three-day estimate, the start day is day one. Dates and estimates remain editable from the web task form and Gantt view.

## 6. Offline recovery

- `.vibe/outbox/`: pending events while the server is unavailable.
- `.vibe/tasks/`: local Markdown mirrors for coding-assistant context.
- `.vibe/daemon.log`: synchronization errors and version conflicts.

The daemon retries when connectivity returns. Do not commit access tokens or outbox contents to Git.

| Symptom | Recovery |
| --- | --- |
| Directory is not bound | Create or select the cloud project, then run its card's init command in the matching local root |
| Repeated `Not logged in.` | Leave the viewer and run `vibeplan start` to sign in, or explicitly run `vibeplan login`, then check new logs |
| Process runs without successful pulls | Inspect recent logs and check login, connectivity, server URL, and project permissions |
| Unverified old lock | Check the old daemon first; the updated CLI clears a lock only when its recorded PID has exited. Inspect a live PID before removing its lock |
| Repeated version conflict | Read the latest task version using `vibeplan task:show TASK_ID` and reconcile cloud changes before submitting again; retries alone cannot resolve a conflict |
| Missing `logs` or an old version after upgrade | Install `@latest`, inspect version, help, and executable path; temporarily use `tail -f .vibe/daemon.log` |

Task Markdown and `.plan.md` files are cloud mirrors. Editing them directly does not upload changes, and later pulls may overwrite them. Modify cloud tasks through supported web or CLI actions; the daemon pulls mirrors and retries queued CLI events. `vibeplan check` validates the local binding and task-file structure, not every acceptance criterion or server connectivity.

## 7. Local web clarification

The current release does not provide a local task-management web mode. This keeps all members on the same cloud task state. Local machines contain the Git working tree, coding-assistant context, and synchronization cache. A future `vibeplan web` command could provide offline browser management, but it is not required for the current workflow.

## 8. 任务详细计划、风险和依赖

任务可以保存只读的详细计划 Markdown，建议包含目标、范围、实施步骤、改动文件、风险、测试方案和验收清单。daemon 会将它同步为 `.vibe/tasks/TASK_ID.plan.md`，普通任务字段仍保存在 `.vibe/tasks/TASK_ID.md`。

项目任务列表会根据子任务、截止日期、更新时间和完成度计算已逾期、长期未更新和进度落后风险。依赖关系会显示阻塞来源，并阻止存在未完成前置任务的任务开始。项目健康度汇总平均进度、逾期、阻塞、停滞和里程碑。

## 9. 工时与成员贡献

任务可以记录实际工时和工作日志。实际工时按记录作者统计，与预估和进度贡献分别展示；没有真实工时的历史记录显示未记录，不从估算天数或提交数量推算。任务中途更换负责人时，保留交接前后的进度贡献及实际协作记录，贡献不是绩效评分。

## 10. Detailed plans, risk, and contribution (English)

Each task can store a read-only Markdown execution plan. The daemon mirrors it to `.vibe/tasks/TASK_ID.plan.md` while keeping regular task metadata in `.vibe/tasks/TASK_ID.md`. The project view reports overdue, stale, and schedule-lag risks, weighted child progress, dependency blockers, and milestone health. Contributions use work-log authors and actual recorded hours; missing historical hours stay unrecorded rather than inferred from estimated days or the current assignee.
## 11. 批量执行计划 / Execute a plan locally

项目管理页的“执行计划”选择未完成叶子任务并复制准备命令。填写项目真实测试命令的 JSON 参数数组，例如 `["npm","test"]`；没有默认包管理器。先在对应的已绑定仓库中登录 Vibe Plan，并安装、登录 Codex CLI。网页不能直接驱动本地代码执行，daemon 仍只负责同步。

```sh
vibeplan plan:prepare --task TASK_UUID --check '["npm","test"]'
vibeplan plan:run --file .vibe/batch-plan.json --approve
vibeplan plan:status --file .vibe/batch-plan.json
```

省略 `--task` 会选择所有未完成叶子任务，可重复 `--task` / `--check`。准备后检查 `.vibe/batch-plan.json` 的云端任务快照、详细计划、验收项和依赖，按需修改 `tasks[].checks` 与 `integrationChecks`；检查均为参数数组，不解析 shell 脚本。确认此清单后才运行 `--approve`，授权覆盖此范围内的任务，不必逐个确认。代码由本地 Codex 串行实现并单独只读复核；测试运行真实命令。

默认成功任务进入待验收，依赖等待前置任务验收通过。只有明确授权自动验收且账号有审核权限，才添加 `--auto-accept`；真实测试和独立复核必须覆盖所有必需验收项。整体集成结果独立记录，单项验收通过不保证整批验证通过。中断后查看状态与日志，核对远程结果，再用 `plan:run --file .vibe/batch-plan.json --approve --resume` 显式恢复；范围变化需重新准备与授权，不盲目重放审批。该流程不授权提交、推送或发布，新命令需要含本功能的 CLI 版本。

In Project management, “执行计划” selects unfinished leaf tasks and copies a local preparation command. Enter the project's actual test command as JSON argv; install and authenticate Codex CLI and bind/sign in to Vibe Plan first. Only the local CLI snapshots cloud tasks and runs code; the browser and sync daemon cannot perform local implementation. Review the manifest's frozen scope, plans, criteria, dependencies, `tasks[].checks` and `integrationChecks` before `--approve`. Repeated flags select more tasks/checks; omitting `--task` selects all unfinished leaves. Commands execute directly without shell parsing.

Execution is serial, with workspace-write implementation, separate read-only review and genuine test results. Human acceptance is the default; dependent work waits until predecessors are accepted. Explicit reviewer-authorized `--auto-accept` additionally requires passing checks and independent review of every mandatory criterion. Integration evidence is separate from task acceptance. Inspect status/logs and remote outcomes before explicit `--resume`; scope drift requires a new snapshot and authorization. Commit, push and publication remain outside this authorization. Use a CLI release containing these commands; current registry installation does not guarantee unpublished features.

已有清单不会被准备命令覆盖；新范围使用 `plan:prepare --file .vibe/batch-plan-next.json` 并重新授权。清单 maxAttempts 默认 2、可配置 1–3（最多额外重试两次）。集成检查失败时批次保持失败，即使部分任务已验收，也不代表整个计划已验收。

Preparation never overwrites an existing manifest; use `plan:prepare --file .vibe/batch-plan-next.json` for a new authorized scope. maxAttempts defaults to 2 and allows 1–3 implementation attempts (at most two extra retries). Failed integration checks leave the batch failed even if individual tasks were accepted; never infer whole-plan acceptance.

终端实时显示执行输出，`plan:status` 给出状态及日志路径，无需登录也能查看本地记录。每次执行的实现、复核及测试输出保存在 `<清单路径>.runs/`，整体验证保存在其中的 integration 目录；输出有大小上限。云端成功测试证据记录真实命令和退出码，详细输出保存在本地并提供给只读复核，不把测试名称里的“error”等词误当失败。Ctrl-C 停止本次执行；恢复自动验收时要保留原来的 `--auto-accept` 参数。

The terminal streams execution output. `plan:status` shows the local state and log path even while signed out. Implementation, review and check logs live under `<manifest path>.runs/`, with bounded output. Successful cloud check evidence records the actual command and exit code; detailed output stays local and is supplied to the read-only reviewer. Ctrl-C stops execution. Preserve `--auto-accept` when resuming a run originally authorized for automatic acceptance.
