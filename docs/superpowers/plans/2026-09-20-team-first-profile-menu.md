# 团队主入口与个人工作区菜单实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工作区改为“团队”主入口，通过左上角头像菜单管理个人资料和组织上下文，并让组织/团队/项目创建隐藏内部标识、项目 Git 地址可选。

**Architecture:** `WorkspacePage` 继续持有组织、团队和项目上下文，新增用户状态和 `ProfileMenu`；组织页面收敛为团队页面，头像菜单负责组织切换和新建组织。API 保留内部 slug 兼容字段，由服务端自动生成；项目 repository URL 改为 nullable，前端在缺失时显示能力提示。

**Tech Stack:** React 18, TypeScript, Fastify, Zod, Drizzle ORM, PostgreSQL, Vitest, Testing Library.

---

### Task 1: 让服务端自动生成内部标识并允许空 Git 地址

**Files:**
- Modify: `apps/api/src/app.ts` schema 定义和创建路由
- Modify: `apps/api/src/modules/access/service.ts` 创建组织/团队/项目方法
- Modify: `apps/api/src/db/schema.ts` projects.repositoryUrl 类型
- Modify: `apps/api/src/db/migrate.ts` projects.repository_url 兼容迁移
- Test: `apps/api/src/modules/access/access.test.ts`
- Test: `apps/api/src/db/schema.test.ts`

- [ ] **Step 1: Write failing API tests**

增加三个行为断言：

```ts
const organization = await access.createOrganization(user.id, '设计团队');
expect(organization.slug).toMatch(/^org-[a-f0-9]{8}-[a-f0-9]{8}$/);

const team = await access.createTeam(user.id, organization.id, '前端');
expect(team.slug).toMatch(/^team-[a-f0-9]{8}-[a-f0-9]{8}$/);

const project = await access.createProject(user.id, team.id, '移动端', undefined);
expect(project.slug).toMatch(/^project-[a-f0-9]{8}-[a-f0-9]{8}$/);
expect(project.repositoryUrl).toBeNull();
```

同时用 `app.inject` 验证 `POST /organizations`、`POST /organizations/:id/teams` 和 `POST /teams/:id/projects` 不传 slug 时返回 2xx，项目不传 `repositoryUrl` 时返回空值。

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```bash
DATABASE_URL=postgres://$(whoami)@localhost:55433/vibe_plan_test pnpm vitest run apps/api/src/modules/access/access.test.ts apps/api/src/db/schema.test.ts
```

Expected: FAIL because current schemas require slug and `repositoryUrl`.

- [ ] **Step 3: Implement the minimal API/data change**

在 access service 增加 `makeSlug(prefix, name)`：使用名称生成短 hash，仅用于保证稳定格式，再拼接随机 UUID 的前 8 位；组织、团队和项目分别使用 `org-`、`team-`、`project-` 前缀，保证同名也唯一。创建方法签名改为 `createOrganization(userId, name)`, `createTeam(userId, organizationId, name)`, `createProject(userId, teamId, name, repositoryUrl?: string)`，并同步更新所有 service 测试调用。

将 Zod schema 改为：

```ts
const organizationSchema = z.object({ name: z.string().trim().min(1).max(120) });
const teamSchema = organizationSchema;
const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  repositoryUrl: z.string().url().optional().or(z.literal('')),
});
```

在 Drizzle schema 中将 `projects.repositoryUrl` 改为可空；迁移脚本追加 `alter table projects alter column repository_url drop not null`，使用 `if exists` 保护重复启动。已有 slug 和已有 Git 值保持不变。

- [ ] **Step 4: Run focused tests and verify they pass**

```bash
DATABASE_URL=postgres://$(whoami)@localhost:55433/vibe_plan_test pnpm vitest run apps/api/src/modules/access/access.test.ts apps/api/src/db/schema.test.ts
```

Expected: all access/schema tests pass.

- [ ] **Step 5: Commit the backend change**

```bash
git add apps/api/src/app.ts apps/api/src/modules/access/service.ts apps/api/src/db/schema.ts apps/api/src/db/migrate.ts apps/api/src/modules/access/access.test.ts apps/api/src/db/schema.test.ts
git commit -m "feat: simplify organization and project creation API"
```

### Task 2: 增加用户菜单和组织切换状态

**Files:**
- Create: `apps/web/src/workspace/ProfileMenu.tsx`
- Modify: `apps/web/src/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/api/src/modules/auth/service.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/modules/auth/auth.test.ts`

- [ ] **Step 1: Write failing web tests**

补充测试覆盖：

```tsx
expect(screen.getByRole('button', { name: '打开个人菜单' })).toBeTruthy();
fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
expect(screen.getByRole('menuitem', { name: '个人资料' })).toBeTruthy();
expect(screen.getByRole('menuitem', { name: '新建组织' })).toBeTruthy();
```

再用两个组织数据验证菜单中的组织切换按钮触发 `onOrganizationChange`，无组织数据时显示“先新建组织”。

- [ ] **Step 2: Run the focused web test and verify failure**

```bash
pnpm vitest run apps/web/src/app.test.tsx -t "个人菜单|组织切换"
```

Expected: FAIL because no profile menu exists.

- [ ] **Step 3: Implement ProfileMenu and wire user state**

让 `WorkspacePage` 在挂载时请求 `/auth/me`，保存 `{ id, email, displayName }` 和 `organizations`。在 `AuthService` 增加 `updateProfile(userId, displayName)`，并增加 `PATCH /auth/me`，只允许修改显示名称，邮箱保持只读。新增 `ProfileMenu` props：

```ts
type Props = {
  user: { email: string; displayName?: string | null };
  organizations: Organization[];
  organizationId: string;
  onSelectOrganization: (id: string) => void;
  onCreateOrganization: () => void;
};
```

组件使用 `<button aria-label="打开个人菜单">` 作为头像，菜单使用 `role="menu"`/`role="menuitem"`，包含个人资料占位入口、组织列表、创建组织和无组织引导。切换组织调用 `onSelectOrganization` 并关闭菜单。

- [ ] **Step 4: Run web tests and verify pass**

```bash
pnpm vitest run apps/web/src/app.test.tsx
```

Expected: existing tests plus the new profile-menu tests pass.

- [ ] **Step 5: Commit the profile menu change**

```bash
git add apps/web/src/workspace/ProfileMenu.tsx apps/web/src/workspace/WorkspacePage.tsx apps/web/src/app.test.tsx apps/web/src/styles.css
git commit -m "feat: add profile menu and organization switching"
```

### Task 3: 将主导航和组织页面改为团队入口

**Files:**
- Modify: `apps/web/src/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/workspace/OrganizationPage.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing navigation tests**

断言主导航不再出现“组织与团队”，而显示“团队”；点击后保留团队卡片、新增团队和返回组织上下文的能力。组织数据为空时，页面应出现“先新建组织”按钮。

```tsx
expect(screen.getByRole('button', { name: '团队' })).toBeTruthy();
expect(screen.queryByRole('button', { name: '组织与团队' })).toBeNull();
```

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm vitest run apps/web/src/app.test.tsx -t "团队|组织"
```

Expected: FAIL because current nav label is “组织与团队”.

- [ ] **Step 3: Implement the team-first page**

将 `View` 中的 `organization` 视图改名为 `teams`，导航按钮文案改为“团队”。`OrganizationPage` 保留团队卡片和新增团队弹窗，但隐藏组织 slug 展示和组织级主标题；无组织时渲染明确的新建组织引导，创建入口交给 `ProfileMenu` 回调。组织切换后的 `contextVersion` 刷新 teams/projects/items，并清理失效的 selected project/team。

- [ ] **Step 4: Run focused tests and verify pass**

```bash
pnpm vitest run apps/web/src/app.test.tsx
```

Expected: all web tests pass with the new team label and empty-organization state.

- [ ] **Step 5: Commit the team-first navigation change**

```bash
git add apps/web/src/workspace/WorkspacePage.tsx apps/web/src/workspace/OrganizationPage.tsx apps/web/src/app.test.tsx apps/web/src/styles.css
git commit -m "feat: make teams the primary workspace navigation"
```

### Task 4: 简化创建表单并显示 Git 能力提示

**Files:**
- Modify: `apps/web/src/workspace/OrganizationPage.tsx`
- Modify: `apps/web/src/workspace/ProjectsPage.tsx`
- Modify: `apps/web/src/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing form tests**

验证组织和团队弹窗不再出现“标识”输入；项目弹窗不再出现“项目标识”，Git 地址没有 `required`，空地址时创建按钮仍可提交。

```tsx
fireEvent.click(screen.getByRole('button', { name: '新增项目' }));
expect(screen.queryByLabelText('项目标识')).toBeNull();
expect((screen.getByLabelText('Git 地址') as HTMLInputElement).required).toBe(false);
```

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm vitest run apps/web/src/app.test.tsx -t "创建表单|Git"
```

Expected: FAIL because current forms still render slug fields and require Git URL.

- [ ] **Step 3: Implement form changes and capability state**

创建组织/团队请求只发送 `name`；项目请求只发送 `name`、`repositoryUrl`（空值转换为 `undefined`）。移除 slug state/input。项目卡片和顶部上下文在 repositoryUrl 为空时显示“未配置 Git”；打开任务看板仍可用，代码同步/关系图入口显示禁用说明而不阻止项目创建。

- [ ] **Step 4: Run web tests and verify pass**

```bash
pnpm vitest run apps/web/src/app.test.tsx
```

Expected: all form, navigation and existing project view tests pass.

- [ ] **Step 5: Commit the form change**

```bash
git add apps/web/src/workspace/OrganizationPage.tsx apps/web/src/workspace/ProjectsPage.tsx apps/web/src/workspace/WorkspacePage.tsx apps/web/src/app.test.tsx apps/web/src/styles.css
git commit -m "feat: simplify creation forms and support projects without git"
```

### Task 5: 全量验证和兼容性检查

**Files:**
- Modify: `README.md` with the new creation behavior and missing-Git capability note

- [ ] **Step 1: Run the complete verification suite**

```bash
DB_USER=$(whoami)
DATABASE_URL=postgres://$DB_USER@localhost:55433/vibe_plan_test pnpm test
pnpm lint
pnpm build
git diff --check
curl -fsS http://localhost:4000/health
```

Expected: all Vitest files pass, TypeScript and build exit 0, diff check is empty, health returns `{"status":"ok"}`.

- [ ] **Step 2: Manually verify the browser flow**

At `http://localhost:5173/`, verify:

1. Sidebar shows “团队”; “组织与团队” is absent.
2. Avatar menu opens and lists profile, current organization, organization switch, and new organization.
3. A user with no organization sees the new-organization guide.
4. Organization/team/project dialogs contain no slug fields.
5. A project with an empty Git address can be created and shows the missing-Git capability notice.

- [ ] **Step 3: Commit documentation and final changes**

```bash
git add README.md
git commit -m "docs: describe team-first workspace flow"
```
