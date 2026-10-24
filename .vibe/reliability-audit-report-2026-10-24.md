# 可靠性审查修复报告

## 状态

代码修复、静态验证与数据库集成验证完成。

## 已完成

- 前端账单联系提示与任务报告校验错误使用可访问的 `role="alert"`。
- 生产环境 CORS allowlist、认证密钥校验和独立认证限流；注册接口也纳入认证限流。
- 父任务更新校验、跨项目/自环/循环保护，以及历史父子循环迁移清理。
- 依赖关系表回填和创建/更新双写；阻塞、校验、列表、关联失效读取关系表作为真源。
- 邀请链接和邮箱邀请接受均在同一事务内条件锁定 active/pending 行，撤销/拒绝与接受按数据库锁串行化。
- 设备授权码、密码重置令牌和团队加入审批改为原子消费/事务抢占，避免重复会话、重复重置和成员状态不一致。
- 支付回调锁定订单并拒绝重复交易号；外部支付创建移出数据库事务，失败订单会标记为 `failed`。
- 实时事件不再在事务内部广播；代理信任通过 `TRUST_PROXY` 显式配置。
- 账单并发保护与前端回归覆盖保持有效。
- 集成测试默认按文件串行执行，避免共享 PostgreSQL 清理事务死锁；认证用例使用随机邮箱，避免本地残留数据影响结果。

## 验证

- `pnpm lint`：通过。
- `pnpm build`：通过。
- `pnpm exec vitest run apps/api/src/app.test.ts -t 'api security configuration'`：6 tests passed。
- `pnpm exec vitest run apps/web/src/workspace/BillingPage.test.tsx apps/web/src/workspace/TaskReportForm.test.tsx apps/web/src/workspace/TaskAcceptanceActions.test.tsx`：12 tests passed。
- 使用 `.env` 数据库连接分别运行 `apps/api/src/modules/access/access.test.ts`（7 tests）、`apps/api/src/modules/billing/orders.test.ts`（3 tests）和工作项父任务排期/删除用例（2 tests），均通过。
- 使用正确的 `DATABASE_URL` 运行默认 `pnpm test`：64 files、391 tests 全部通过。
- `pnpm lint`、`pnpm build` 与 `vibeplan check`：全部通过。

## 剩余问题

- CI/本机仍须显式设置 `DATABASE_URL`；未设置时，数据库客户端会回退到本地默认连接。
- `pnpm test:e2e` 尚未在本轮运行，需要有可用浏览器和测试环境时单独验证。
