# Vibe Plan 可靠性与协作实施报告

日期：2026-10-05。对应计划：docs/superpowers/plans/2026-10-04-vibeplan-reliability-and-workflow.md。

## 状态与范围

状态：本地 ready_for_review，未自动验收。六个阶段的代码、使用说明和隔离验证已完成。当前公开发布基线仍为 0.1.9，本轮没有修改发布版本、发布 npm、构建/推送 Docker 镜像或部署服务器。

在 codex/reliability-workflow-20261005 分支实施。原工作区已有大量未提交/未跟踪功能，本轮全部保留，没有重置、覆盖或提交混合变更。没有新建云端任务；本机检查显示未登录，未将本地测试结果冒充为云端执行报告。

## 主要实现与改动文件

- API：apps/api/src/app.ts、db/schema.ts、db/migrate.ts、runtime/version.ts、modules/work-items/service.ts、mutations.ts、sync-feed.ts。事务内记录幂等结果；重复请求返回原结果且重新检查权限；参数不匹配返回冲突。项目锁内维护同步序号、分页及删除记录，关联父任务/依赖派生变化；一致快照、过期游标重置、保留窗口自动压缩。结构化测试结果与退出码、HTTP(S) 证据、字段大小限制、本轮验收周期、贡献与今日工作接口。
- 登录：apps/api/src/modules/auth/service.ts。原子轮换刷新令牌，防止相同令牌并发兑换多份会话；按实际 JWT TTL 返回过期秒数。限流错误保留 429，不再显示为 500。
- CLI：apps/cli/src/api-client.ts、session-identity.ts、sync/outbox.ts、sync/state.ts、sync/task-mirror.ts、commands/sync.ts、execution.ts、task.ts、status.ts、check.ts、lifecycle.ts、daemon.ts、install-codex.ts。发送前持久化操作 ID，队列绑定原账号/服务器；冲突、失效身份和旧队列保留并暂停。能力检测、增量同步、每小时全量补偿、仅变更时原子写镜像、托管删除镜像归档、指数退避、5MiB/5份日志轮转。增加 task:log、task:log-edit、task:log-withdraw，后两者使用 --log-version。旧服务不能静默丢弃结构化测试字段。
- Web：apps/web/src/workspace/TaskReportForm.tsx、TaskAcceptanceActions.tsx、TaskEvidencePanels.tsx、TodayWork.tsx、WorkspacePage.tsx、ProjectManagementPage.tsx、ProjectContributors.tsx、ContributorBreakdown.tsx、ProjectAnalytics.tsx、useProjectEvents.ts、styles.css。网页报告与按账号/任务隔离的草稿、冲突保留；历史验收周期标识、安全证据链接；今日工作与任务深链接；日期筛选的实际协作记录；估算贡献与实际工时分开；SSE 重连补拉及低频补偿。
- Skill 与文档：packages/templates/src/index.ts、docs/user-guide.md、docs/task-execution.md、apps/cli/README.md、README.md、deploy/server/README.md。同步中英文执行、升级、失效、冲突恢复、真实工时和验收规则。托管 Skill 更新保留标记外自定义内容；强制迁移旧格式文件先生成备份。没有覆盖本机全局 Skill。
- 验证与发布：playwright.config.ts、tests/e2e/*、scripts/verify-npm-package.sh、verify-release.sh、publish-npm.sh、镜像构建脚本、docker/api.Dockerfile、web.Dockerfile、docker-compose.prod.yml、packages/templates/tsconfig.json、package.json、pnpm-lock.yaml。独立数据库与账号、实际浏览器和打包 CLI 流程，版本/构建提交注入、发布包检查及只读部署核对脚本；模板发布物不包含测试编译文件。

## 验证证据

- 独立数据库：postgres://vibe:vibe@localhost:5433/vibe_plan_test。没有修改或清空本地原业务数据库。
- DATABASE_URL=postgres://vibe:vibe@localhost:5433/vibe_plan_test pnpm test：41 文件、238 测试通过。
- pnpm lint：通过。pnpm -r build：全部工作区构建通过。
- pnpm test:e2e：3 项通过，20.1 秒。覆盖原生短时令牌连续续期、真实两成员浏览器生命周期、实际打包 CLI。负向场景包含权限、未验收、失败报告、旧版本和未完成依赖。
- 打包 CLI 使用独立临时安装及内存认证适配器，不访问真实钥匙串。计划/开始/进度/工时/报告实际调用独立 API；丢弃已提交报告的响应后，以原操作 ID 和原任务版本重试，只有一份报告与一次版本递增。
- scripts/verify-npm-package.sh：临时安装、版本、命令参数、真实报告解析、Skill 安装/托管更新/自定义内容保留/旧文件备份和依赖解析通过。Skill 临时生成物格式校验通过。
- node apps/cli/dist/index.js check：本地绑定及结构通过；诊断显示 CLI 0.1.9、未登录、无待上传事件、daemon 未运行、旧本机 Skill 与新模板不同。没有为验证强行登录或替换用户规则。
- 1000任务实验：快照 777977 字节；无变化增量 85 字节；单任务更新 1723 字节。CLI 镜像测试验证无变化不重写、写盘失败不推进游标和托管归档。
- 独立交叉审查修复：请求头/能力/同步响应协议不匹配、待审核绕过退回、旧周期标签、删除子任务漏父任务变化、切账号重放、结构化字段被旧服务器忽略、不可验证锁清理和 Skill 工时版本参数。

## 仍需执行的发布工作与限制

- 用户另行要求发布后，确定新版本号，发布匹配 CLI/templates 和 API/Web 镜像，再部署并执行 verify-release.sh VERSION API_URL。只有部署新 API 后线上才能提供本轮能力；本地网页若仍代理云 API，也会受旧服务器能力限制。
- 没有做 Docker 镜像实际构建或远程 Traefik 部署验证。更新只使用增量迁移；镜像回滚不会自动撤销数据库迁移，说明已包含备份与兼容限制。
- 没有真实云端项目写入，也没有自动批准云端任务。发布包安装验证不等同于已发布 registry 版本实测。
- 本轮没有接入 Git 提供商自动采集；报告支持手动 Commit SHA 与 HTTP(S) 仓库/PR证据，不以 Commit 数自动计算绩效。daemon 同步任务上下文，不擅自读取任意 Codex 对话或自主执行代码。
- SSE 使用内存通知作唤醒，持久数据库增量流与补偿刷新负责恢复。Web 跨实例丢通知时可能等待最多约60秒的补偿刷新。
- 不直接更改云端镜像文件的任务状态。本报告与计划复选框记录本地实施事实；最终验收由用户进行。
