# AI 任务维护轻量优化实施记录

日期：2026-10-05。状态：本地 ready_for_review，未自动批准验收。
方案：docs/superpowers/plans/2026-10-05-ai-task-maintenance.md。

## 完成内容与变更文件

- apps/cli/src/commands/maintenance.ts：task:context 汇总计划、最新版本、最近事件、当前报告及退回反馈；按验收周期边界排除过期标准和批准后的历史退回。task:update 严格验证 JSON patch，读取最新归属/版本并复用幂等更新队列。
- apps/cli/src/git-evidence.ts：只读本地 Git；候选文件不作任务贡献推断；--git-base 校验祖先关系并采集已提交范围，无新提交不推断 commit。
- apps/cli/src/index.ts、command-args.ts、commands/execution.ts：接入上下文、字段更新和 Git 报告参数；blocked 阶段同时写状态；task:update 支持旧版任务 --version 参数归一化。
- packages/templates/src/index.ts：发布模板引导 AI 维护已授权任务、决策/交接写入原计划、原任务修复与真实报告。新字段更新不能替代报告、验收或实际工时。没有修改本机全局 Skill。
- docs/task-execution.md、docs/user-guide.md、apps/cli/README.md、.vibe/instructions.md：中英文教程与当前项目规则；同时纠正旧教程将估算天数折为实际工时的错误描述。
- commands/maintenance.test.ts、maintenance-command.test.ts、commands/execution.test.ts、git-evidence.test.ts、scripts/verify-npm-package.sh、tests/e2e/packed-cli-runner.mjs：边界回归、真实临时 Git 仓库、发布包命令/模块验证及真实隔离 API 流程。

## 验证

- DATABASE_URL=postgres://vibe:vibe@localhost:5433/vibe_plan_test pnpm test：44 文件、265 项通过。
- pnpm lint：通过；pnpm -r build：通过。最终维护逻辑修复后再次 CLI build 通过；Skill 描述修正后 templates build 通过。
- bash scripts/verify-npm-package.sh：临时安装实际打包 CLI/templates、帮助参数、严格 patch 和托管 Skill 更新/保留自定义规则检查通过。没有全局安装。
- pnpm test:e2e：3 项通过，包含原生续期、浏览器生命周期和打包 CLI。验收历史修复后 pnpm exec playwright test tests/e2e/packed-cli.spec.ts 再次通过（1 项、7.3 秒）。打包流程验证 context、blocked 状态、task:update 恢复、报告重试幂等，以及退回后仍读取逐项反馈。
- Skill Creator quick_validate.py：临时生成的 Skill 格式有效。
- git diff --check、node apps/cli/dist/index.js check：通过；诊断显示本机未登录、daemon 未运行、无待上传事件、全局 Skill 与模板不同。
- 独立只读审查发现并修正两项验收历史边界，新增回归并通过复审。

## 剩余事项与限制

本轮没有更改版本号、发布 npm、构建推送镜像或部署服务器。用户升级全局 CLI 需要先发布新版，再更新托管 Skill、项目规则及旧 daemon。网页复用已有只读计划、进度、验收和报告，没有新增菜单或数据库迁移。

本机没有可用登录会话，没有新建或改写真实云端任务；本文件记录本地实施事实，不将测试当成云端验收。现有工作区改动保留，没有混合提交。

本轮实现的是 AI 在当前已授权对话中的维护工具与规则，daemon 仍只负责同步。完整 GitHub/GitLab PR/CI 集成、容量排期、截图附件上传与通知中心没有加入；Git、时间和 AI 判断不自动证明完成或生成工时。
