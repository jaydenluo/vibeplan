import { and, eq } from 'drizzle-orm';
import { db, sqlClient } from './client.js';
import {
  organizationMemberships,
  organizations,
  projectMemberships,
  projects,
  teamMemberships,
  teams,
  users,
  workItems,
} from './schema.js';

const targetEmail = process.env.SEED_EMAIL ?? '651715003@qq.com';

async function main() {
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, targetEmail)).limit(1);
  if (!user) throw new Error(`Target user does not exist: ${targetEmail}`);

  let [organization] = await db.select().from(organizations).where(eq(organizations.slug, 'demo-codex-workspace')).limit(1);
  if (!organization) {
    [organization] = await db.insert(organizations).values({ name: 'Codex 计划示例工作区', slug: 'demo-codex-workspace' }).returning();
  }
  await db.insert(organizationMemberships).values({ userId: user.id, organizationId: organization.id, role: 'owner' }).onConflictDoNothing();

  let [team] = await db.select().from(teams).where(and(eq(teams.organizationId, organization.id), eq(teams.slug, 'product-engineering'))).limit(1);
  if (!team) {
    [team] = await db.insert(teams).values({ organizationId: organization.id, name: '产品研发团队', slug: 'product-engineering' }).returning();
  }
  await db.insert(teamMemberships).values({ userId: user.id, teamId: team.id, role: 'lead' }).onConflictDoNothing();

  let [project] = await db.select().from(projects).where(and(eq(projects.teamId, team.id), eq(projects.slug, 'codex-plan-demo'))).limit(1);
  if (!project) {
    [project] = await db.insert(projects).values({
      teamId: team.id,
      name: 'Vibe Plan 协作平台',
      slug: 'codex-plan-demo',
      repositoryUrl: 'https://github.com/example/vibe-coding-plan.git',
    }).returning();
  }
  await db.insert(projectMemberships).values({ userId: user.id, projectId: project.id, role: 'maintainer' }).onConflictDoNothing();

  const existing = await db.select({ id: workItems.id }).from(workItems).where(eq(workItems.projectId, project.id));
  if (existing.length > 0) {
    console.log(JSON.stringify({ user, organization, team, project, createdTaskCount: 0, existingTaskCount: existing.length }, null, 2));
    return;
  }

  const base = { projectId: project.id, reporterId: user.id, assigneeId: user.id, labels: ['示例数据'], dependsOn: [], version: 1 };
  const [foundation] = await db.insert(workItems).values({ ...base, title: '建立项目基础架构', description: '完成 Vibe Plan 的基础工程搭建，让团队可以登录、创建组织与团队，并开始管理项目。', type: 'feature', status: 'done', priority: 'P0', dueDate: '2026-09-25', component: '平台基础', acceptanceCriteria: ['用户可以通过邮箱注册并登录', '组织、团队和项目数据按权限隔离', 'Web 与 API 服务可以在本地启动'], estimate: 8 }).returning();
  const [planning] = await db.insert(workItems).values({ ...base, title: '项目计划与任务管理', description: '提供专业的项目管理工作台，支持项目卡片、任务列表、子任务层级和时间线。', type: 'feature', status: 'in_progress', priority: 'P0', dueDate: '2026-10-10', component: '项目管理', acceptanceCriteria: ['项目以卡片列表展示', '进入项目后显示项目目录与任务树', '任务支持主任务和子任务关系'], estimate: 13 }).returning();
  const [auth] = await db.insert(workItems).values({ ...base, title: '账号与组织协作', description: '补齐账号、组织、团队和成员协作流程。', type: 'feature', status: 'done', priority: 'P1', dueDate: '2026-09-28', component: '协作基础', acceptanceCriteria: ['邮箱验证码注册可用', '用户可以切换组织', '团队成员可以被邀请并审批'], estimate: 8 }).returning();
  const [projectCards] = await db.insert(workItems).values({ ...base, title: '项目卡片列表', description: '将项目管理首页调整为更容易扫描的卡片式项目入口。', type: 'improvement', status: 'done', priority: 'P1', dueDate: '2026-09-30', component: '项目管理', parentId: planning.id, acceptanceCriteria: ['卡片显示项目名称与所属团队', '显示 Git 连接状态', '点击卡片进入项目管理页'], estimate: 3 }).returning();
  const [projectShell] = await db.insert(workItems).values({ ...base, title: '独立项目管理工作台', description: '进入项目后隐藏全局菜单，使用项目目录承载项目切换，右侧展示当前项目内容。', type: 'feature', status: 'in_progress', priority: 'P1', dueDate: '2026-10-03', component: '项目管理', parentId: planning.id, acceptanceCriteria: ['详情页可以返回项目列表', '左侧显示项目目录', '默认选中进入的项目'], estimate: 5 }).returning();
  const [taskTree] = await db.insert(workItems).values({ ...base, title: '任务与子任务层级', description: '把 parentId 关系转换为可读的任务树，支持多级缩进和任务摘要。', type: 'feature', status: 'ready', priority: 'P1', dueDate: '2026-10-06', component: '任务管理', parentId: planning.id, acceptanceCriteria: ['没有父任务的条目作为一级任务', '子任务按父任务缩进展示', '点击任务可以查看状态、优先级和描述'], estimate: 5 }).returning();
  await db.insert(workItems).values({ ...base, title: '任务树视觉层级优化', description: '增加任务层级缩进、状态颜色和截止日期显示，提升快速定位效率。', type: 'improvement', status: 'backlog', priority: 'P2', dueDate: '2026-10-08', component: '任务管理', parentId: taskTree.id, acceptanceCriteria: ['主任务与子任务有明确视觉层级', '不同状态使用稳定的颜色标识'], estimate: 3 });
  await db.insert(workItems).values({ ...base, title: '时间线视图', description: '按截止日期整理任务，帮助团队观察近期交付节奏和延期风险。', type: 'feature', status: 'ready', priority: 'P2', dueDate: '2026-10-12', component: '项目管理', parentId: planning.id, acceptanceCriteria: ['任务按截止日期排序', '未设置截止日期的任务集中显示', '可从时间线打开任务摘要'], estimate: 5 });
  await db.insert(workItems).values({ ...base, title: 'Git 仓库连接提示', description: '项目 Git 地址为可选配置；未配置时允许继续使用任务管理，但明确提示代码同步与仓库分析不可用。', type: 'improvement', status: 'done', priority: 'P2', dueDate: '2026-09-29', component: '代码同步', parentId: planning.id, acceptanceCriteria: ['Git 地址可以为空', '未配置 Git 时显示能力提示', '配置 Git 后显示已连接状态'], estimate: 3 });
  await db.insert(workItems).values({ ...base, title: '修复新建项目团队下拉为空', description: '当团队数据异步加载完成后，创建项目弹窗应自动选中第一个可用团队。', type: 'bug', status: 'done', priority: 'P1', dueDate: '2026-09-22', component: '项目管理', parentId: projectCards.id, acceptanceCriteria: ['团队异步加载后下拉出现选项', '没有团队时禁用创建按钮', '创建项目请求带上 teamId'], estimate: 2 });
  await db.insert(workItems).values({ ...base, title: '注册验证码确认流程', description: '注册表单先发送验证码，用户填写验证码后再提交注册；开发环境允许通过配置关闭验证。', type: 'feature', status: 'done', priority: 'P1', dueDate: '2026-09-24', component: '账号与组织', parentId: auth.id, acceptanceCriteria: ['验证码发送成功后显示输入框', '验证码正确才完成注册', '关闭验证配置时可以直接注册'], estimate: 5 });
  await db.insert(workItems).values({ ...base, title: '组织成员邀请与审批', description: '组织管理员邀请成员加入指定团队，受邀用户在审批页接受或拒绝。', type: 'feature', status: 'done', priority: 'P1', dueDate: '2026-09-26', component: '协作基础', parentId: auth.id, acceptanceCriteria: ['管理员可以按邮箱邀请', '邀请可指定团队', '成员可以接受或拒绝邀请'], estimate: 5 });
  await db.insert(workItems).values({ ...base, title: '项目详情加载失败提示', description: '模拟网络异常时显示可理解的错误信息，并允许通过刷新按钮再次加载任务。', type: 'bug', status: 'backlog', priority: 'P2', dueDate: '2026-10-15', component: '项目管理', parentId: projectShell.id, acceptanceCriteria: ['请求失败时显示错误提示', '点击刷新后重新请求任务', '错误不会阻塞返回项目列表'], estimate: 2 });

  console.log(JSON.stringify({ user, organization, team, project, createdTaskCount: 13 }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => sqlClient.end());
