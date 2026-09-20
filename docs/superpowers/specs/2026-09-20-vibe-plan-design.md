# Vibe Plan 设计与任务规划

## 1. 项目定位

Vibe Plan 是一个面向 Codex 团队开发的项目协作系统。它让团队成员通过服务器共享结构化开发计划，让 Codex 在本地工作区执行任务，并通过 Git 管理代码和规则。

核心定位：

> 服务器保存实时协作计划，Git 保存代码和审计历史，本地 CLI 连接 Codex、项目文件和服务器。

## 2. 目标与非目标

### 目标

- 支持邮箱注册、登录、邮箱验证和密码重置。
- 支持组织、团队、项目三级权限边界。
- 支持项目级任务管理、负责人、优先级、类型、截止时间、依赖和验收标准。
- 支持网页端实时查看和修改任务状态。
- 支持本地 CLI 登录、绑定项目和同步任务。
- 通过 `AGENTS.md` 和 `.vibe/instructions.md` 为 Codex 提供项目规则。
- 关联 Git 分支、提交、修改文件和任务。
- 在本地分析代码并上传可共享的关系图快照。
- 提供 Docker Compose 自部署方式。

### 非目标

- 第一版不远程启动或托管 Codex。
- 第一版不保存完整源代码到服务器。
- 第一版不实现 Jira、Linear 或 GitHub Issues 的双向同步。
- 第一版不实现复杂的工时、Sprint、计费和企业 SSO。
- 第一版不把 AI 自动标记 `done` 作为可信状态来源。

## 3. 产品边界与事实来源

| 内容 | 事实来源 |
|---|---|
| 实时任务状态、负责人、评论、权限 | 服务器数据库 |
| 源代码、分支、提交、合并历史 | Git 仓库 |
| Codex 项目规则 | 仓库中的 `AGENTS.md` 和 `.vibe/instructions.md` |
| 本地任务上下文 | `.vibe/` 缓存 |
| 代码关系图 | 本地索引生成的服务器快照 |

服务器和 Git 不同时无规则地修改同一任务字段。服务器任务数据可以导出为 `.vibe` 快照，用于离线恢复和审计，但实时状态以服务器为准。

## 4. 账号、组织、团队和项目

层级关系：

```text
User -> Organization -> Team -> Project -> WorkItem
```

### 账号

第一版采用邮箱和密码注册。注册后必须完成邮箱验证，才能创建组织、接受邀请或访问项目。

用户能力：

- 注册、登录、退出登录。
- 邮箱验证和重新发送验证邮件。
- 忘记密码和一次性重置链接。
- 修改密码和邮箱。
- 查看自己所属组织和团队。

密码使用 Argon2id 或 bcrypt 哈希。验证链接和重置链接使用一次性随机 Token，并设置过期时间。生产环境必须使用 HTTPS，并对注册、登录和邮件接口限流。

### 组织

组织是最大的数据隔离边界。组织角色：

- `owner`
- `admin`
- `member`

首次注册用户可以创建组织，也可以通过邀请加入现有组织。

### 团队

团队属于组织。团队角色：

- `lead`
- `member`
- `viewer`

团队可以拥有多个项目。第一版一个项目只属于一个团队。

### 项目

项目属于团队，并绑定一个 Git 仓库地址。项目角色：

- `maintainer`
- `contributor`
- `viewer`

项目 ID 是服务器生成的稳定 ID。项目名称可以修改，项目 ID 不变。

## 5. 登录和 CLI 授权

网页端使用安全会话。CLI 使用设备授权流程：

```text
vibe login --server URL
  -> CLI 生成一次性设备码
  -> 浏览器完成网页登录和授权
  -> CLI 获得短期 access token 和可撤销 refresh token
  -> Token 保存到操作系统 Keychain
```

Token 不写入 Git、`.vibe` 或命令日志。建议 access token 短期有效，refresh token 可轮换和撤销。CLI 提供 `vibe whoami` 和 `vibe logout`。

## 6. 项目初始化和同步

用户先登录，再绑定项目：

```bash
vibe login --server https://vibe.example.com
vibe org list
vibe org use acme
vibe team list
vibe team use frontend
vibe init --project-id proj_abc123
```

`vibe init` 行为：

- 本地不存在 `.vibe`：检查项目存在性和权限，然后拉取项目配置。
- 本地已有同一项目：执行同步，不覆盖未提交内容。
- 本地绑定其他项目：提示并拒绝，除非用户显式使用 `--force`。
- `--force` 覆盖前保存 `.vibe.backup/<timestamp>/`。
- 服务器项目不存在时默认报错；项目创建使用 `vibe project create` 或显式 `--create`。

项目初始化生成或更新：

```text
.vibe/
  project.yaml
  instructions.md
  tasks/
  cache/
AGENTS.md
```

## 7. 任务模型

后端统一使用 `WorkItem`，界面显示为任务。核心字段：

```text
id
project_id
title
description
type
status
priority
assignee_id
reporter_id
due_date
labels
component
parent_id
depends_on
acceptance_criteria
estimate
created_at
updated_at
completed_at
```

任务类型：

- `feature` 功能开发
- `bug` Bug 修复
- `improvement` 优化改进
- `refactor` 重构
- `documentation` 文档
- `research` 技术调研
- `chore` 工程维护

任务状态：

```text
backlog -> ready -> in_progress -> in_review -> done
                         |                 |
                         v                 v
                      blocked           cancelled
```

优先级采用 `P0` 到 `P4`。任务支持负责人、创建人、截止时间、标签、组件、父子任务、依赖、评论、活动记录、验收标准、Git 分支和提交关联。

任务状态转换由服务器校验。进入 `done` 必须有验收记录或人工确认；Codex 只能提交完成建议和测试证据。

## 8. Codex 集成

项目根目录的 `AGENTS.md` 作为 Codex 入口，要求 Codex 读取 `.vibe/instructions.md` 和当前任务文件。

`.vibe/instructions.md` 定义：

- 领取任务规则。
- 任务状态和提交格式。
- 必须运行的检查和测试。
- 完成任务时必须记录的修改文件、测试结果和遗留问题。

Superpowers 和 Codex 内置 Plan 负责当前工作流和执行步骤；服务器任务负责长期共享状态。不得将每一个临时执行步骤自动写成团队任务。

CLI 命令：

```bash
vibe task list
vibe task show T-001
vibe task start T-001
vibe task report T-001
vibe check
```

## 9. 实时同步

服务器采用 REST API 处理写入，采用 SSE 或 WebSocket 推送更新。任务变更写入 `TaskEvent`，再推送给有权限的项目成员。

任务更新使用版本号或乐观锁：客户端提交旧版本时，服务器拒绝静默覆盖并返回冲突信息。评论和活动记录采用追加式事件，减少多人修改冲突。

本地 CLI 可以提供可选的 `vibe daemon`，但默认只同步语义化任务事件，不监听每一次文件保存。

## 10. Git 集成

Git 负责代码同步。任务与 Git 的关联使用约定提交信息：

```text
[T-001] implement email login
```

服务器保存提交哈希、分支、作者和任务 ID。CLI 通过 `vibe task report` 上传工作摘要、修改文件、测试结果和当前 commit。

代码关系图不保存完整源代码。用户本地执行 `vibe index`，生成文件、模块、测试、符号和任务关系摘要，再上传到服务器。服务器只保存图谱快照及其对应 commit。

## 11. 代码关系图

第一版支持以下关系：

- 任务 -> 文件。
- 文件 -> 文件依赖。
- 文件 -> 测试文件。
- 文件 -> 模块、类和函数。
- 任务 -> Git 提交。

实现定义 `Indexer` 接口，第一版使用 Tree-sitter 或语言 AST 做增量分析。Understand-Anything 的知识图谱、增量索引和可视化思路可以作为参考或后续适配器，但不是第一版强依赖。

## 12. 系统组件

推荐采用 TypeScript 单仓库：

```text
apps/
  api/       NestJS API、认证、权限、SSE/WebSocket
  web/       React/Vite 页面
  cli/       vibe 命令行
packages/
  core/      领域模型和状态转换
  schema/    Zod/JSON Schema 校验
  git/       Git 读取和提交关联
  indexer/   Tree-sitter/AST 代码分析
  templates/ AGENTS.md 和 .vibe 模板
```

基础设施：

- PostgreSQL：用户、组织、团队、项目、任务、事件和图谱快照。
- 邮件服务：SMTP。
- Docker Compose：自部署。
- Redis 暂不需要，只有在任务队列或多实例推送需要时再增加。

## 13. 实施阶段

### Phase 1：账号和组织基础

- 邮箱注册、验证、登录、退出和密码重置。
- 组织创建、邀请和成员列表。
- 团队创建、成员和角色。
- 项目创建、项目 ID 和项目权限。
- PostgreSQL 迁移和权限测试。

验收：新用户验证邮箱后能创建组织、团队和项目；被邀请用户只能看到被授权的组织、团队和项目。

### Phase 2：任务管理和实时网页

- WorkItem 数据模型和状态机。
- 类型、优先级、负责人、截止时间、标签和依赖。
- 评论和活动记录。
- 网页看板、列表、详情和筛选。
- SSE/WebSocket 实时刷新。
- 乐观锁和冲突提示。

验收：两个浏览器登录同一项目，任意一端修改任务，另一端能实时看到变化。

### Phase 3：本地 CLI 和 Codex 工作流

- `vibe login` 设备授权。
- `vibe init --project-id`。
- `vibe org/team/project` 上下文选择。
- `.vibe` 本地缓存和 `AGENTS.md` 模板。
- `vibe task start/report/check/sync`。
- Token Keychain 存储。

验收：用户可以在本地打开 Codex，读取任务、修改代码、上传完成报告并保留 Git commit。

### Phase 4：Git 和图谱

- 提交信息任务关联。
- 分支、commit 和测试报告关联。
- 本地代码增量索引。
- 图谱快照上传和网页查看。
- 任务到文件、模块、测试的反向定位。

验收：从一个任务可以定位相关代码和提交，从一个模块可以反查相关任务。

### Phase 5：部署和质量增强

- Docker Compose 部署。
- SMTP 配置向导。
- 数据库备份和恢复。
- 审计日志和权限审查。
- 离线缓存和重新连接。
- 可选的 `vibe daemon`。

## 14. 关键风险

- 邮件服务和密码认证必须优先做好安全边界。
- 服务器与 Git 的职责必须保持清晰，避免双向静默覆盖。
- 图谱上传可能泄露内部代码结构，需要项目级配置和访问控制。
- 任务状态自动化必须保守，不能用 AI 生成的摘要直接证明完成。
- 组织、团队、项目权限必须在 API 查询层强制执行，不能只依赖前端隐藏。

## 15. MVP 成功标准

一个新团队能够完成：

```text
邮箱注册并验证
  -> 创建组织和团队
  -> 创建项目并绑定 Git
  -> 创建并分配 T-001
  -> 成员在本地登录 CLI
  -> vibe init --project-id ...
  -> Codex 执行任务
  -> 上传测试结果和 commit
  -> 网页端实时看到状态和活动
```

第一版不追求替代完整的 Jira 或 GitHub，而是先把“团队任务协作 + 本地 Codex 执行 + Git 代码关联”这条链路做完整。
