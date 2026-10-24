# Reliability Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复审查中确认的前端反馈、安全配置、任务关系、邀请、账单和迁移可靠性问题，并用回归测试证明结果。

**Architecture:** 继续沿用 Fastify 服务层、Drizzle schema、React MessageCenter 和 Vitest。每项修复先写最小回归测试，再修改对应边界；数据库关系变化通过幂等迁移完成，避免影响现有数据。

**Tech Stack:** TypeScript, Fastify, Drizzle/PostgreSQL, React, Vitest, Playwright, pnpm。

---

### Task 1: 修复前端反馈与测试隔离

**Files:**
- Modify: `apps/web/src/workspace/BillingPage.tsx`
- Modify: `apps/web/src/workspace/TaskReportForm.tsx`
- Modify: affected web tests that mock `apps/web/src/api/client.ts`

- [x] 写出账单联系提示和报告校验错误的失败测试。
- [x] 运行对应测试确认失败。
- [x] 渲染 `message` 和 `error`，补充 `role="alert"`。
- [x] 更新 mock 的 `showMessage`，消除 unhandled rejection。
- [x] 运行相关测试并确认通过。

### Task 2: 收紧认证与跨源配置

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `.env.example` and deployment docs if needed

- [x] 增加生产 CORS allowlist 和缺失 secret 的失败测试。
- [x] 增加注册验证码、密码重置和登录的独立限流配置与测试。
- [x] 实现配置校验，开发测试保留显式 development fallback，生产拒绝默认 secret。
- [x] 运行 API 定向测试。

### Task 3: 修复父子任务更新和依赖一致性

**Files:**
- Modify: `apps/api/src/modules/work-items/service.ts`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/migrate.ts`
- Add/modify: work-item relation tests

- [x] 添加 PATCH parentId、跨项目父任务、自身父任务和循环父任务的服务层校验。
- [x] 增加依赖关系表回填，并让新增/更新同步关系表。
- [x] 实现事务内关系校验、外键和幂等回填。
- [x] 将阻塞计算、依赖校验、依赖列表和同步失效改为从关系表读取；保留 JSONB 双写兼容旧客户端。
- [x] 迁移时清理已有自环和循环父子关系。
- [x] 使用显式 `DATABASE_URL` 运行工作项和 schema 测试。

### Task 4: 邀请链接与账单并发保护

**Files:**
- Modify: `apps/api/src/modules/access/service.ts`
- Modify: `apps/api/src/modules/billing/service.ts`
- Modify: `apps/api/src/app.ts`
- Add/modify: access and billing tests

- [x] 添加邀请撤销回归测试；分享链接和邮箱邀请接受流程均在事务内条件更新 active/pending 行以解决撤销竞态。
- [x] 保留组织级账单订单锁和幂等确认测试。
- [x] 实现管理员撤销路由、事务接受和组织级订单锁/幂等规则。
- [x] 使用显式 `DATABASE_URL` 运行 access、billing 和 API 测试。

### Task 6: 认证、事件与代理并发修复

**Files:**
- Modify: `apps/api/src/modules/auth/service.ts`
- Modify: `apps/api/src/modules/work-items/service.ts`
- Modify: `apps/api/src/modules/billing/service.ts`
- Modify: `apps/api/src/modules/access/service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: deployment environment examples

- [x] 设备码和密码重置令牌使用条件更新原子消费。
- [x] 团队加入审批使用事务和 pending 条件抢占。
- [x] 支付回调锁定订单、拒绝重复 provider transaction，并将外部支付创建移出数据库事务。
- [x] 实时事件只由已提交的外层操作广播。
- [x] 反向代理信任配置显式化，限流按真实客户端 IP 工作。
- [x] 依赖读取忽略跨项目历史关系，避免污染当前项目阻塞状态。

### Task 5: 全量验证与审查

**Files:**
- No product changes unless verification exposes a regression.

- [x] 运行 `pnpm lint`。
- [x] 运行 `pnpm build`。
- [x] 使用显式 `DATABASE_URL` 运行默认 `pnpm test`：64 files、391 tests passed。
- [ ] 在可用浏览器和测试环境中运行 `pnpm test:e2e`。
- [x] 对照设计逐项检查并整理剩余风险。
