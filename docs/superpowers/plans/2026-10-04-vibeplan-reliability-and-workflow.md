# Vibe Plan 可靠性与日常协作优化实施计划

> 执行说明：2026-10-05 已实施本地代码并进行隔离验证。以下复选框记录本地结果；发布、真实部署核对与云端任务操作单独保留，不表示已经发布或自动验收。

**目标：** 让用户放心持续使用 Vibe Plan，并清楚知道今天做什么、哪里受阻、哪些交付需要验收。

**架构：** 复用 PostgreSQL 任务、报告、事件与工作记录；保持 CLI、Web、API、Skill 分工。先补足端到端验证与同步可靠性，再增强验收、工作入口和贡献归因，不新增独立调度或自动执行代码系统。

**技术栈：** TypeScript、Node.js 22、React、Fastify、Drizzle、PostgreSQL、Vitest、pnpm、Docker、Traefik；浏览器端到端验证拟使用 Playwright。

## 基线、范围与设计选择

当前基线是 0.1.9：支持任务计划、阶段回报、报告证据、权限验收、递归进度、风险、成员分析及离线冲突暂停。npm 和本机 CLI 的 0.1.9 已核对，云健康接口正常；真实账号完整流程仍需专门验证。

推荐增量优化。一次性重构同步和协作系统会增加回归风险；只增加界面入口则无法解决断线、冲突和证据可信度。每阶段产出可单独发布，保留旧 CLI/报告兼容，数据库迁移采用增加字段与表的方式。

不在本轮引入：自动读取任意 Codex 对话、无人批准的自动验收、AI 自动打分绩效、任意本地 Markdown 自动覆盖云端、附件上传存储服务。Git 关联首先允许手动关联，自动接入提供商另行实施。

每项任务类型建议 improvement；不预填开始/截止日期。下列估算是初始规划天数，按完成项动态修正，不作为固定承诺。

| 阶段 | 内容 | 优先级 | 初始估算 | 前置条件 |
|---|---|---|---|---|
| 1 | 真实流程与发布验证 | P1 | 2 天 | 无 |
| 2A | 同步幂等与冲突恢复 | P1 | 3 天 | 阶段 1 |
| 2B | 增量同步、断线恢复和镜像管理 | P1 | 4 天 | 阶段 2A |
| 3 | 结构化验收证据与网页报告 | P1 | 3 天 | 阶段 1 |
| 4 | 今日工作与下一步入口 | P2 | 3 天 | 阶段 3 |
| 5 | 成员贡献与实际工时归因 | P2 | 3 天 | 阶段 3 |
| 6 | 版本兼容与运行状态引导 | P1 | 2 天 | 阶段 1，最终覆盖全部阶段 |

推荐执行顺序：1 → 2A → 2B → 3 → 6 → 4 → 5。阶段 6 的发布元信息可提前完成，最终引导在其余功能稳定后更新。

## 阶段 1：真实流程与发布验证

**问题：** 单元测试通过不能证明发布后的 Web、CLI、数据库和反向代理能协同工作。

**相关文件：** apps/api/src/app.test.ts、apps/api/src/modules/auth/auth.test.ts、apps/api/src/modules/work-items/closure.test.ts；新增 tests/e2e/task-lifecycle.spec.ts、playwright.config.ts；package.json、scripts/publish-npm.sh、部署说明。

- [x] 增加隔离测试配置，使用独立测试数据库和测试账号，禁止重置真实项目数据。浏览器自动化只针对本地或专门测试环境。
- [x] 编写两成员场景：有审核权限的负责人和普通成员，完成创建→计划→开始→阶段回报→交接→失败报告→修复→提交验收→逐项通过→批准。
- [x] 增加负向场景：成员无权审核、失败不能批准、缺少必验项不能完成、退回缺少理由、旧版本提交、未完成依赖阻止开始。
- [x] 验证两终端同时续期以及 CLI 连续两次续期。使用短时测试令牌模拟过期，不等待真实 30 天。
- [x] 从打包产物安装 CLI 到临时目录，验证 --version、task:plan、task:progress、task:report --file、Skill 内容和公开包依赖解析。
- [ ] 部署后只读核对版本与健康；需要云端实际写入时使用明确的测试项目，保留记录和清理范围。

**验收标准：** 完整流程可重复通过；测试不触碰生产数据；报告区分软件问题、发布问题和环境问题；没有以健康接口成功代替业务验证。

**验证：** pnpm exec playwright test tests/e2e/task-lifecycle.spec.ts；相关 auth/closure 回归；本地 npm 包安装检查。预期完整流程通过，拒绝场景保留正确状态及历史。

## 阶段 2A：同步幂等与冲突恢复

**问题：** 服务端已提交但响应丢失时，CLI 无法确定操作是否成功；重试可能产生冲突。暂停队列目前需要用户手动检查和移除。

**相关文件：** apps/api/src/db/schema.ts、migrate.ts、app.ts、modules/work-items/service.ts；新增 modules/work-items/mutations.ts 及 mutations.test.ts；apps/cli/src/api-client.ts、sync/outbox.ts、commands/sync.ts、index.ts、commands/sync-recovery.test.ts。

- [x] 定义 mutationId（UUID）、projectId、actorId、请求摘要和结果记录；同一用户相同 ID 与相同请求返回原结果，不产生第二条任务事件。
- [x] 将幂等记录与任务更新放在同一数据库事务；相同 ID 不同请求返回明确冲突；记录不包含令牌或密码。
- [x] CLI 在第一次发送前持久保存操作 ID；直接请求与离线重试使用同一 ID，覆盖更新、报告和验收。
- [x] 测试服务器提交成功后连接断开，再次发送返回原结果，版本只增加一次。
- [x] 改善暂停项检查：显示任务标题、期望/当前版本、字段差异与错误原因；提供保留报告、放弃旧操作、重新提交的明确步骤。
- [x] 不自动改版本覆盖他人变更，不自动重放批准；同一任务有暂停操作时后续关联操作提示依赖受阻，其他任务正常同步。

**验收标准：** 响应丢失不产生重复报告、工作记录或批准；冲突保留原始内容；不同用户无法读取幂等结果；旧客户端无 ID 的请求维持旧协议。

**验证：** mutations.test.ts 验证并发同 ID、提交后断线、参数不匹配、跨用户隔离；sync-recovery.test.ts 验证恢复顺序和暂停项数据保留。

## 阶段 2B：增量同步与断线恢复

**问题：** 当前每轮全量拉取并重写本地镜像，日志持续增长；删除和断线恢复需要更明确的数据协议。

**相关文件：** apps/api/src/db/schema.ts、migrate.ts、modules/work-items/events.ts、service.ts、app.ts；新增 modules/work-items/sync-feed.ts、sync-feed.test.ts；apps/cli/src/commands/daemon.ts、sync.ts、sync/task-mirror.ts；新增 sync/checkpoint.ts、sync/log-rotation.ts 及对应测试；apps/web/src/workspace/useProjectEvents.ts。

- [x] 建立项目级单调递增的变更序号与删除记录，在项目写事务内生成。沿用项目锁保证序号提交顺序；不能只用时间戳或无提交顺序保证的全局序列作游标。
- [x] 首次同步返回一致的快照和游标；后续返回游标后的 upsert/delete 分页。校验项目权限，每页只提交已成功写入本地的游标。
- [x] 游标失效或日志保留期已过时要求重新取快照；定期全量核对作为补偿。
- [x] 镜像只有版本或正文变化时才写入，原子替换；云端删除的托管镜像先移到 .vibe/archive，避免残留任务和误删用户文件。
- [x] 网络失败使用带随机抖动的指数退避，从 2 秒到最多 60 秒；成功后恢复正常周期。暂停事件不刷重复错误。
- [x] 日志按大小轮转，默认单文件 5 MiB，最多保留 5 份；显示最近成功同步时间、变更数和失败原因，不输出凭据。
- [x] Web SSE 重连后补拉最新数据，显示连接/重连状态并提供低频补偿刷新，避免断线期间丢事件。
- [x] 多 API 实例阶段使用数据库变更流作为事实来源；内存事件只作唤醒提示，不能作为唯一同步依据。

**验收标准：** 无变化不重写镜像；断线重连不漏更新/删除；进程重启可从安全游标恢复；旧全量接口保留；日志大小受控。直接编辑 .plan.md 仍不自动上传，正文通过 task:plan 更新。

**验证：** 覆盖分页、同刻多变更、事务回滚、游标过期、镜像归档、写盘失败、退避及日志轮转；以 1,000 个任务对比无变化和单任务修改时的响应体积、文件写入次数。

## 阶段 3：结构化验收证据

**相关文件：** apps/api/src/app.ts、modules/work-items/service.ts、closure.test.ts；apps/cli/src/commands/execution.ts、execution.test.ts；apps/web/src/workspace/TaskAcceptanceActions.tsx、TaskEvidencePanels.tsx 及测试；新增 TaskReportForm.tsx、TaskReportForm.test.tsx；packages/templates/src/index.ts。

- [x] 测试条目增加 outcome（passed/failed/skipped/not_run）和可选 exitCode，保留 command/result 兼容旧报告。明确失败标志或非零退出码阻止成功交付。
- [x] 网页表单支持完成说明、修改文件、测试、证据链接、风险、剩余事项、逐项验收对应和成功/失败/阻塞结果。
- [x] 证据 URL 统一只接受 HTTP/HTTPS；历史不支持的链接显示普通文本。限制正文与列表数量，错误定位到具体字段。
- [x] 保存提交中的草稿；版本冲突展示最新状态，不清空用户填写内容。
- [x] 关联验收项允许复用报告证据，但必须由授权审核人明确通过；缺少证据可提示，不把未运行的测试伪装成通过。
- [x] 验收周期标识绑定本轮成功报告，重开后旧报告/审核结论不可自动证明新范围；历史仍可查阅。
- [x] 更新中英文教程与 Skill，指导 AI 从真实执行读取 outcome/exitCode，任务进度不代替验收结论。

**验收标准：** CLI 与 Web 报告信息一致；失败不能冒充成功；旧报告正常展示；冲突不丢草稿；重开任务要求本轮交付证据。

**验证：** API 测试结构化失败与旧文本；Web 测试草稿、冲突、权限、报告和验收操作；CLI 测试 JSON 与重复参数兼容。

## 阶段 4：今日工作与下一步

**相关文件：** apps/api/src/app.ts；新增 modules/work-items/my-work.ts、my-work.test.ts；apps/web/src/workspace/WorkspacePage.tsx；新增 TodayWork.tsx、TodayWork.test.tsx；apps/cli/src/commands/status.ts、status.test.ts。

- [x] 增加按当前用户及所选组织读取的工作摘要：我的进行中、可开始、受阻任务，以及我有权审核的待验收。
- [x] 待验收只列有实际审核权限的项目；跨项目查询复用权限规则，不把其他团队任务带入结果。
- [x] 可开始任务需所有依赖完成或取消；建议下一项按进行中优先、优先级、日期、稳定 ID 排序，给出推荐理由。
- [x] 今日视图是工作队列，不擅自更改任务排期；日期展示使用用户时区并标清服务端截止口径。
- [x] 在现有 overview 加入口，点击任务跳转其项目和所选任务；刷新保留定位。支持空状态、筛选和紧凑布局。
- [x] CLI status 使用同一可开始规则，避免把被依赖阻塞的任务建议为立即开始。

**验收标准：** 用户能快速找到自己的工作与待验收；每个推荐有理由；无权限任务不泄露；推荐不自动启动任务或调整日期。

**验证：** 多项目/成员/审核权限组合；未分配与取消任务；依赖删除或受阻；时间边界；深链接与浏览器刷新。

## 阶段 5：贡献与实际工时归因

**相关文件：** apps/api/src/modules/work-items/metrics.ts、service.ts、metrics.test.ts、db/schema.ts；apps/web/src/workspace/ProjectAnalytics.tsx、ProjectManagementPage.tsx；新增 ContributionBreakdown.tsx 与测试；apps/cli/src/index.ts、commands/execution.ts；packages/templates/src/index.ts。

- [x] 工时按工作记录 userId 归属实际记录人，区分任务总工时与成员工时，不把交接前工时全部转给当前负责人。
- [x] 交接进度仍用于估算贡献，标记为推算；实际工时、报告、测试、审核、估算进度分别展示，不合成未经验证的绩效分。
- [x] 增加 task:log 输入实际小时、工作内容和日期；修改/撤销工作记录按权限记录审计，不由 daemon 自动推算工时。
- [x] 允许手动关联 Commit SHA、仓库/PR URL；Git 未配置仍可管理任务，链接本身不自动证明成果。
- [x] 报表区分时间范围、当前负载与历史贡献；历史成员保留姓名/标识，缺少估算或工作记录显示未记录。
- [x] Skill 指导 AI 记录已知的真实工作证据，不将运行时长、代码行数或 Commit 数直接当作贡献度。

**验收标准：** A 记录 2 小时后交接给 B，A 保留 2 小时，B 的新增记录只归 B；报告、审核、交接可追溯；不重复计算父子任务贡献。

**验证：** 交接、多次交接、离职成员、记录修正、父子任务、时间范围与缺失记录；CLI 权限/校验和贡献视图测试。

## 阶段 6：版本兼容与运行引导

**相关文件：** apps/api/src/app.ts；新增 runtime/version.ts；apps/cli/src/commands/status.ts、lifecycle.ts、check.ts、version.ts；packages/templates/src/index.ts；apps/web/src/workspace/ProfileMenu.tsx；docker/api.Dockerfile、web.Dockerfile、scripts/publish-npm.sh、镜像构建脚本、docs/user-guide.md、docs/task-execution.md、apps/cli/README.md。

- [x] API 提供应用版本、构建提交、协议版本及能力列表；版本来源于构建注入，健康接口继续保持简单兼容。
- [x] CLI status/check 显示本机 CLI、服务器、模板/Skill、当前 daemon 版本和最后同步结果；不能从 PID 存活推断同步成功。
- [x] 启动时验证所需能力；旧服务器缺少增量/幂等功能时提示并安全退回旧接口，不悄悄丢弃报告字段。
- [x] daemon 锁记录版本，检测旧版提示重启；只操作可验证属于当前项目的进程。
- [x] Skill 更新保留自定义内容并展示版本差异；AGENTS.md 仍只更新托管区块。不要静默覆盖用户规则。
- [x] 发布脚本核对打包内容、registry 可见版本、镜像标签和构建提交。部署说明包含更新、检查与回滚步骤。
- [x] 中英文与 npm 内说明同步覆盖安装、登录续期、启动/停止、冲突恢复、计划/报告、验收和升级。

**验收标准：** 用户可判断各端版本是否匹配及后台是否同步；升级不覆盖规则；旧客户端/服务器给出明确兼容行为；回滚说明指出数据库迁移限制。

**验证：** 新旧服务器能力组合、旧 daemon、用户自定义 Skill、发布包和镜像元数据、健康/业务失败区分。

## 执行、验证与交付规则

- [x] 各阶段先增加能复现问题的回归测试，观察失败，再做最小实现；完成后运行相关测试。
- [x] 数据库迁移验证旧数据读取、重复迁移和失败恢复；使用独立测试数据库。
- [x] 全量验证：DATABASE_URL=postgres://vibe:vibe@localhost:5433/vibe_plan_test pnpm test；pnpm lint；pnpm -r build；vibeplan check；新增 Playwright 完整流程。
- [ ] 每阶段记录修改文件、测试证据、实际结果和剩余问题，再进行代码审查；只提交本阶段相关文件，保留现有工作区其他修改。
- [ ] 如用户要求加入 Vibe Plan，复用已有相关任务，补建缺口；每项写完整描述、验收、优先级、估算和详细计划，不设无依据的截止日期。
- [ ] 开始云端任务前读取最新版本；报告成功保留待验收，失败/阻塞保留现场，最终由用户批准。
- [x] 本计划不自动触发 npm 发布或服务器部署。交付后按明确发布请求执行，发布前核对回归与兼容结果。

## 当前计划状态

本地实现和隔离验证记录见 .vibe/reliability-workflow-report-2026-10-05.md。已独立交叉审查并修复协议、验收周期和贡献归因问题。在 codex/reliability-workflow-20261005 分支保留全部原有工作区修改，没有提交混合变更。没有发布 npm、构建/推送镜像、部署服务器或新建云端任务；相关未勾选项留待相应请求及部署后的实测。0.1.9 仍是已发布基线，不能把本地实现视为当前线上功能。
