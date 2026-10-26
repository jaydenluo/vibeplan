/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './app.js';
import { OrganizationPage } from './workspace/OrganizationPage.js';
import { TeamDetailPage } from './workspace/TeamDetailPage.js';
import { ProjectsPage } from './workspace/ProjectsPage.js';
import { ProjectManagementPage } from './workspace/ProjectManagementPage.js';
import { ProfileMenu } from './workspace/ProfileMenu.js';
import { WorkspacePage } from './workspace/WorkspacePage.js';
import { WorkItemCreateForm } from './workspace/WorkItemCreateForm.js';
import { RegisterPage } from './auth/RegisterPage.js';
import { messageEvent } from './api/client.js';

describe('web app', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/'); });

  it('shows the login entry point before authentication', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'Access token is required.' } }) }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '登录 Vibe Plan' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '注册' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the registration form after navigating from login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/config')) return { ok: true, status: 200, json: async () => ({ emailVerificationRequired: false }) };
      return { ok: false, status: 401, json: async () => ({ error: { message: 'Access token is required.' } }) };
    }));
    render(<App />);

    await waitFor(() => expect(screen.getByRole('heading', { name: '登录 Vibe Plan' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: '创建账号' })).toBeTruthy());
    expect(window.location.pathname).toBe('/register');
  });

  it('requires a name when registering and submits it with the account', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/auth/config') ? { emailVerificationRequired: false } : {} }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);
    const name = screen.getByLabelText('姓名') as HTMLInputElement;
    expect(name.required).toBe(true);
    fireEvent.change(name, { target: { value: '王明' } });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'wang@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct horse battery staple' } });
    await waitFor(() => expect(screen.queryByLabelText('邮箱验证码')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/register$/), expect.objectContaining({ body: JSON.stringify({ email: 'wang@example.com', password: 'correct horse battery staple', displayName: '王明' }) })));
  });

  it('disables registration-code sending when email delivery is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ emailVerificationRequired: true, emailDeliveryConfigured: false }) }));
    render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);

    expect(await screen.findByText('邮件服务尚未配置，请联系管理员。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '获取验证码' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains that a registration code must be requested instead of disabling registration', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emailVerificationRequired: true, emailDeliveryConfigured: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '王明' } });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'wang@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('请先获取邮箱验证码')).toBeTruthy();
    expect((screen.getByRole('button', { name: '注册' }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/auth\/register$/), expect.anything());
  });

  it('submits an entered six-digit code even when this page did not send it', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith('/auth/config')
        ? { emailVerificationRequired: true, emailDeliveryConfigured: true }
        : {},
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '王明' } });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'wang@example.com' } });
    fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '725051' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/register$/), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'wang@example.com', password: 'correct horse battery staple', displayName: '王明', verificationCode: '725051' }),
    })));
  });

  it('shows Chinese field errors without sending an incomplete registration', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emailVerificationRequired: true, emailDeliveryConfigured: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('请输入姓名')).toBeTruthy();
    expect(screen.getByText('请输入有效的邮箱地址')).toBeTruthy();
    expect(screen.getByText('请先获取邮箱验证码')).toBeTruthy();
    expect(screen.getByText('密码至少需要 8 位')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/auth\/register$/), expect.anything());
  });

  it('starts and restores a 30-second registration-code resend cooldown', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ emailVerificationRequired: true, emailDeliveryConfigured: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const first = render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'member@example.com' } });
    expect((screen.getByRole('button', { name: '获取验证码' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '30 秒后重新发送' })).toBeTruthy());
    expect((screen.getByRole('button', { name: '30 秒后重新发送' }) as HTMLButtonElement).disabled).toBe(true);

    first.unmount();
    render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'member@example.com' } });
    expect(await screen.findByRole('button', { name: '30 秒后重新发送' })).toBeTruthy();
  });

  it('keeps registration-code cooldown isolated per email address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ emailVerificationRequired: true, emailDeliveryConfigured: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage onRegistered={vi.fn()} onLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'first@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '30 秒后重新发送' })).toBeTruthy());

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'second@example.com' } });
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '获取验证码' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('creates a task with the standard planning fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'task-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<WorkItemCreateForm projectId="project-1" onCreated={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText('实际工时（小时）')).toBeNull();
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '实现任务同步' } });
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'feature' } });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'ready' } });
    fireEvent.change(screen.getByLabelText('优先级'), { target: { value: 'P1' } });
    fireEvent.change(screen.getByLabelText('计划结束日期'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('预估工时（天）'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('完成度（%）'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '同步任务状态到服务器。' } });
    fireEvent.change(screen.getByLabelText('验收标准 1'), { target: { value: '状态更新可实时显示' } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/projects\/project-1\/work-items$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: '实现任务同步', type: 'feature', status: 'ready', priority: 'P1', dueDate: '2026-10-20', estimate: 3, progress: 40, description: '同步任务状态到服务器。', acceptanceCriteria: ['状态更新可实时显示'] }) })));
  });

  it('creates a child task with its parent id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'child-1' }) });
    const onCreated = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<WorkItemCreateForm projectId="project-1" parentId="task-1" parentTitle="主任务" onCreated={onCreated} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '子任务' } });
    fireEvent.change(screen.getByLabelText('计划结束日期'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '实现子任务。' } });
    fireEvent.change(screen.getByLabelText('验收标准 1'), { target: { value: '子任务可完成' } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/projects\/project-1\/work-items$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: '子任务', type: 'feature', status: 'backlog', priority: 'P2', dueDate: '2026-10-20', estimate: 1, progress: 0, description: '实现子任务。', acceptanceCriteria: ['子任务可完成'], parentId: 'task-1' }) })));
    expect(onCreated).toHaveBeenCalledWith('child-1');
  });

  it('allows optional schedule, description, and acceptance fields to stay empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'task-2' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<WorkItemCreateForm projectId="project-1" onCreated={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '只填写必要字段' } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/projects\/project-1\/work-items$/), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: '只填写必要字段', type: 'feature', status: 'backlog', priority: 'P2', dueDate: null, estimate: 1, progress: 0, description: '', acceptanceCriteria: [] }),
    })));
  });

  it('restores an existing browser session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      const payload = path.endsWith('/auth/me')
        ? { id: 'user-1', email: 'user@example.com' }
        : [];
      return { ok: true, json: async () => payload };
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '工作台' })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: '团队管理' })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: '打开个人菜单' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '展开菜单' }));
    expect(screen.getByText('vdev')).toBeTruthy();
    expect(screen.getByRole('button', { name: '项目管理' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '待办审批' })).toBeTruthy();
    const primaryNavigation = within(screen.getByRole('navigation', { name: '主导航' }));
    expect(primaryNavigation.getAllByRole('button').slice(0, 5).map((button) => button.getAttribute('aria-label'))).toEqual(['总览', '项目管理', '任务看板', '团队管理', '待办审批']);
    expect(primaryNavigation.getAllByRole('button').slice(0, 5).every((button) => button.querySelector('svg'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '任务看板' }));
    expect(screen.queryByRole('heading', { name: '项目计划' })).toBeNull();
    expect(screen.queryByRole('button', { name: '批准 CLI 设备码' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
    expect(screen.getByRole('menuitem', { name: 'CLI 设备授权' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: '项目任务视图' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '同步项目' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建任务' })).toBeNull();
  });

  it('restores the workspace page from its browser URL', async () => {
    window.history.replaceState({}, '', '/projects');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      const payload = path.endsWith('/auth/me') ? { id: 'user-1', email: 'user@example.com' }
        : path.endsWith('/organizations') ? [{ id: 'org-1', name: '甲组织', slug: 'org-1' }]
          : path.endsWith('/organizations/org-1/teams') ? [{ id: 'team-1', name: '研发', slug: 'dev' }]
            : path.endsWith('/organizations/org-1/projects') ? [{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]
              : [];
      return { ok: true, json: async () => payload };
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '项目' })).toBeTruthy());
    expect(window.location.pathname).toBe('/projects');
    fireEvent.click(screen.getByRole('button', { name: '团队管理' }));
    expect(window.location.pathname).toBe('/teams');
  });

  it('returns to the login page when an authenticated page receives a 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) {
        return { ok: true, json: async () => ({ id: 'user-1', email: 'user@example.com' }) };
      }
      return { ok: false, status: 401, json: async () => ({ error: { message: 'Access token is required.' } }) };
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('heading', { name: '工作台' })).toBeNull());
  });

  it('uses organization cards and modal creation before showing teams', () => {
    render(<OrganizationPage organizations={[{ id: 'org-1', name: 'Acme', slug: 'acme' }]} organization={undefined} teams={[]} onSelectOrganization={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Acme/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新增组织' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '新增组织' })).toBeTruthy();
    expect(screen.queryByLabelText('组织标识')).toBeNull();
  });

  it('edits a team from its card without submitting a join request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'team-1', name: '平台组', slug: 'team-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrganizationPage organizations={[{ id: 'org-1', name: 'Acme', slug: 'acme' }]} organization={{ id: 'org-1', name: 'Acme', slug: 'acme' }} teams={[{ id: 'team-1', name: '研发', slug: 'dev' }]} onSelectOrganization={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑团队 研发' }));
    expect(screen.getByRole('heading', { name: '编辑团队' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '平台组' } });
    fireEvent.click(screen.getByRole('button', { name: '保存团队' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/teams\/team-1$/), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: '平台组' }) })));
  });

  it('opens team details from a team card instead of showing a join action', () => {
    const onOpen = vi.fn();
    render(<OrganizationPage organizations={[{ id: 'org-1', name: 'Acme', slug: 'acme' }]} organization={{ id: 'org-1', name: 'Acme', slug: 'acme' }} teams={[{ id: 'team-1', name: '研发', slug: 'dev' }]} onSelectOrganization={vi.fn()} onChanged={vi.fn()} onOpenTeam={onOpen} />);
    expect(screen.queryByRole('button', { name: '申请加入' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '进入团队 研发' }));
    expect(onOpen).toHaveBeenCalledWith('team-1');
  });

  it('generates an organization invite link for organization admins', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'org-token', expiresAt: '2026-10-01T00:00:00.000Z' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrganizationPage organizations={[{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'owner' }]} organization={{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'owner' }} teams={[]} onSelectOrganization={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '邀请加入组织' }));
    fireEvent.click(screen.getAllByRole('button', { name: '生成邀请链接' })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/organizations\/org-1\/invite-links$/), expect.objectContaining({ method: 'POST', body: '{}' })));
    expect(screen.getByLabelText('邀请链接')).toBeTruthy();
  });

  it('manages team members and invites from the team details page', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/details')) return { ok: true, json: async () => ({ team: { id: 'team-1', name: '研发', slug: 'dev' }, members: [{ userId: 'user-1', displayName: '王明', email: 'wang@example.com', role: 'lead' }, { userId: 'user-2', displayName: '李雷', email: 'li@example.com', role: 'member' }], canManage: true, projectsCount: 3 }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TeamDetailPage organizationId="org-1" team={{ id: 'team-1', name: '研发', slug: 'dev' }} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '研发' })).toBeTruthy());
    expect(screen.getByText('关联项目').parentElement?.textContent).toBe('3关联项目');
    expect(screen.getByText('王明')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('角色 李雷'), { target: { value: 'lead' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/teams\/team-1\/members\/user-2$/), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'lead' }) })));
    fireEvent.click(screen.getByRole('button', { name: '移除 李雷' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/teams\/team-1\/members\/user-2$/), expect.objectContaining({ method: 'DELETE' })));
    fireEvent.click(screen.getByRole('button', { name: '生成邀请链接' }));
    fireEvent.click(screen.getAllByRole('button', { name: '生成邀请链接' })[1]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/organizations\/org-1\/invite-links$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ teamId: 'team-1' }) })));
    expect(screen.getByLabelText('邀请链接')).toBeTruthy();
  });

  it('keeps team details read-only for regular members', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ team: { id: 'team-1', name: '研发', slug: 'dev' }, members: [{ userId: 'user-1', displayName: '王明', email: 'wang@example.com', role: 'member' }], canManage: false, projectsCount: 1 }) }));
    render(<TeamDetailPage organizationId="org-1" team={{ id: 'team-1', name: '研发', slug: 'dev' }} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '研发' })).toBeTruthy());
    expect(screen.getByText('只读')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '生成邀请链接' })).toBeNull();
    expect(screen.queryByLabelText('角色 王明')).toBeNull();
  });

  it('remembers the expanded sidebar preference', async () => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      const payload = path.endsWith('/auth/me') ? { id: 'user-1', email: 'user@example.com' } : [];
      return { ok: true, json: async () => payload };
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '工作台' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '展开菜单' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '展开菜单' }));
    expect(screen.getByRole('button', { name: '收起菜单' })).toBeTruthy();
    expect(localStorage.getItem('vibe-plan.sidebar') ).toBe('expanded');
  });

  it('restores the last selected organization', async () => {
    localStorage.setItem('vibe-plan.organization', 'org-2');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      const payload = path.endsWith('/auth/me') ? { id: 'user-1', email: 'user@example.com' }
        : path.endsWith('/organizations') ? [{ id: 'org-1', name: '甲组织', slug: 'org-1' }, { id: 'org-2', name: '乙组织', slug: 'org-2' }]
          : [];
      return { ok: true, json: async () => payload };
    }));
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '任务看板' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '任务看板' }));
    await waitFor(() => expect(localStorage.getItem('vibe-plan.organization')).toBe('org-2'));
    expect(screen.queryByLabelText('组织')).toBeNull();
  });

  it('shows projects as cards and opens a project management page', () => {
    const onOpen = vi.fn();
    render(<ProjectsPage teams={[{ id: 'team-1', name: '研发', slug: 'dev' }]} projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1', description: '统一管理研发任务。' }]} onChanged={vi.fn()} onOpen={onOpen} />);
    expect(screen.getByRole('heading', { name: '项目' })).toBeTruthy();
    const projectCard = screen.getByRole('button', { name: '打开项目 项目一' });
    expect(projectCard).toBeTruthy();
    expect(projectCard.querySelector('.project-card-top strong')?.textContent).toBe('项目一');
    expect(projectCard.querySelector('.project-card-top small')?.textContent).toBe('研发');
    expect(projectCard.querySelector('.project-card-description')?.textContent).toBe('统一管理研发任务。');
    expect(screen.queryByText('Git 已连接')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开项目 项目一' }));
    expect(onOpen).toHaveBeenCalledWith('project-1');
  });

  it('edits a project from its card without opening project management', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'project-1', name: '项目一改名', slug: 'project-1', teamId: 'team-1', description: '新的项目说明。' }) });
    const onOpen = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectsPage teams={[{ id: 'team-1', name: '研发', slug: 'dev' }]} projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1', description: '旧的项目说明。' }]} onChanged={vi.fn()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑项目一' }));
    expect(screen.getByRole('heading', { name: '编辑项目' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '项目一改名' } });
    expect(screen.queryByLabelText('Git 地址')).toBeNull();
    fireEvent.change(screen.getByLabelText('项目描述'), { target: { value: '新的项目说明。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存项目' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/projects\/project-1$/), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: '项目一改名', description: '新的项目说明。' }) })));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('copies the project init command from the project card', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const messages: string[] = [];
    const onMessage = (event: Event) => messages.push((event as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener(messageEvent, onMessage);
    render(<ProjectsPage teams={[{ id: 'team-1', name: '研发', slug: 'dev' }]} projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]} onChanged={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '复制项目初始化命令 项目一' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('vibeplan init --project-id project-1'));
    expect(messages).toContain('复制成功，请到项目下运行命令');
    window.removeEventListener(messageEvent, onMessage);
  });

  it('shows project tasks and nested subtasks in the project management page', async () => {
    const tasks = [
      { id: 'task-1', title: '主任务', type: 'feature', status: 'in_progress', priority: 'P1', progress: 40, dueDate: '2026-09-30', description: '实现任务详情', acceptanceCriteria: ['功能可正常使用', '通过验收检查'], parentId: null, version: 1 },
      { id: 'task-2', title: '子任务', type: 'bug', status: 'done', priority: 'P2', progress: 100, parentId: 'task-1', version: 1 },
    ];
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/teams/team-1/members')) return { ok: true, json: async () => [{ userId: 'user-1', displayName: '王明', email: 'wang@example.com', role: 'member' }] };
      if (path.endsWith('/work-items/task-1') && init?.method === 'PATCH') return { ok: true, json: async () => ({ ...tasks[0], assigneeId: 'user-1', version: 2 }) };
      if (path.endsWith('/work-items/task-2') && init?.method === 'PATCH') return { ok: true, json: async () => ({ ...tasks[1], assigneeId: 'user-1', version: 2 }) };
      return { ok: true, json: async () => tasks };
    });
    vi.stubGlobal('fetch', fetchMock);
    const onBack = vi.fn();
    render(<ProjectManagementPage projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1', repositoryUrl: 'https://example.com/repo.git' }]} activeProjectId="project-1" onBack={onBack} onSelectProject={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /主任务/ }).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('button', { name: /子任务/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: '项目管理' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '甘特图' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '任务详情' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '任务与子任务' })).toBeNull();
    const taskSearch = screen.getByPlaceholderText('搜索任务标题或描述');
    expect(taskSearch).toBeTruthy();
    expect(screen.getByLabelText('优先级筛选')).toBeTruthy();
    expect(screen.getByLabelText('状态筛选')).toBeTruthy();
    expect(screen.getByLabelText('类型筛选')).toBeTruthy();
    expect((screen.getByLabelText('排序方式') as HTMLSelectElement).value).toBe('startDate');
    fireEvent.change(taskSearch, { target: { value: '子任务' } });
    await waitFor(() => expect(within(screen.getByRole('complementary', { name: '任务目录' })).getByRole('button', { name: '子任务 已完成 · bug · P2' })).toBeTruthy());
    fireEvent.change(taskSearch, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('优先级筛选'), { target: { value: 'P1' } });
    expect(within(screen.getByRole('complementary', { name: '任务目录' })).getByRole('button', { name: '主任务 进行中 · feature · P1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '清除优先级筛选' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除优先级筛选' }));
    expect((screen.getByLabelText('优先级筛选') as HTMLSelectElement).value).toBe('all');
    fireEvent.change(screen.getByLabelText('优先级筛选'), { target: { value: 'P1' } });
    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'priority' } });
    expect((screen.getByLabelText('排序方式') as HTMLSelectElement).value).toBe('priority');
    expect(screen.getByRole('button', { name: '清除排序方式' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除排序方式' }));
    expect((screen.getByLabelText('排序方式') as HTMLSelectElement).value).toBe('startDate');
    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'priority' } });
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '清除优先级筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '清除排序方式' }));
    const taskDirectory = screen.getByRole('complementary', { name: '任务目录' });
    expect(within(taskDirectory).getByText('P1').classList.contains('task-priority')).toBe(true);
    expect(document.querySelector('.task-workspace-gantt')).toBeTruthy();
    const priorityStack = taskDirectory.querySelector('.task-priority-stack');
    expect(priorityStack?.querySelector('.task-priority')).toBeTruthy();
    expect(priorityStack?.querySelector('.task-progress')).toBeNull();
    expect(taskDirectory.querySelector('.status-dot')).toBeNull();
    const mainTaskButton = within(taskDirectory).getByRole('button', { name: '主任务 进行中 · feature · P1' });
    const nestedChildTaskButton = within(taskDirectory).getByRole('button', { name: '子任务 已完成 · bug · P2' });
    expect((mainTaskButton.closest('.task-tree-item') as HTMLElement).style.paddingLeft).toBe('10px');
    expect((nestedChildTaskButton.closest('.task-tree-item') as HTMLElement).style.paddingLeft).toBe('24px');
    const mainMeta = mainTaskButton.querySelector('.task-tree-meta');
    expect(mainMeta?.classList.contains('task-tree-meta')).toBe(true);
    expect(mainMeta?.querySelector('.task-meta-status')?.classList.contains('status-in_progress')).toBe(true);
    expect(mainMeta?.querySelector('.task-meta-progress')?.classList.contains('type-feature')).toBe(true);
    expect(mainMeta?.querySelector('.task-meta-progress')?.classList.contains('progress-mid')).toBe(true);
    expect(mainMeta?.querySelector('.task-meta-progress')?.textContent).toBe('功能开发40%');
    expect(mainMeta?.classList.contains('no-wrap')).toBe(true);
    fireEvent.doubleClick(mainTaskButton);
    expect(screen.getByRole('tab', { name: '任务详情' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: '主任务' })).toBeTruthy();
    fireEvent.doubleClick(mainTaskButton);
    expect(screen.getByRole('tab', { name: '甘特图' }).getAttribute('aria-selected')).toBe('true');
    expect(within(taskDirectory).getAllByText('9月30日')).toHaveLength(2);
    expect(within(taskDirectory).queryByText(/开始 9月30日/)).toBeNull();
    expect(within(taskDirectory).queryByText(/结束 9月30日/)).toBeNull();
    expect(document.querySelector('.gantt-resize-handle.start')).toBeTruthy();
    expect(document.querySelector('.gantt-resize-handle.end')).toBeTruthy();
    expect(screen.queryByText('时间轴')).toBeNull();
    expect(document.querySelector('.gantt-toolbar')).toBeNull();
    expect(document.querySelector('.gantt-scroll > .gantt-zoom-controls')).toBeNull();
    expect(document.querySelector('.task-area-header .gantt-zoom-controls')).toBeTruthy();
    expect(document.querySelector('.task-area-header .gantt-batch-toolbar')).toBeTruthy();
    expect(document.querySelector('.gantt-scroll .gantt-batch-toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(screen.getByRole('toolbar', { name: '批量调整任务日期' })).toBeTruthy();
    expect(screen.getByText('未选择任务')).toBeTruthy();
    expect((screen.getByRole('button', { name: '前移 1 天' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('批量日期') as HTMLInputElement).disabled).toBe(true);
    const ganttCalendar = document.querySelector('.gantt-calendar') as HTMLElement;
    const initialColumnStyle = ganttCalendar.style.gridTemplateColumns;
    expect((document.querySelector('.gantt-bar') as HTMLButtonElement).title).toBe('主任务 · 40% · 1 天');
    expect(ganttCalendar.querySelectorAll('span')).toHaveLength(15);
    expect(initialColumnStyle).toContain('38px');
    const ganttScroll = document.querySelector('.gantt-scroll') as HTMLElement;
    Object.defineProperty(ganttScroll, 'clientWidth', { configurable: true, value: 760 });
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(ganttCalendar.querySelectorAll('span')).toHaveLength(20));
    Object.defineProperty(ganttScroll, 'clientWidth', { configurable: true, value: 1520 });
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(ganttCalendar.querySelectorAll('span')).toHaveLength(40));
    const wideColumnStyle = ganttCalendar.style.gridTemplateColumns;
    expect((document.querySelector('.gantt-bar') as HTMLButtonElement).style.width).toBe('2.5%');
    expect((screen.getByRole('button', { name: '放大' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '缩小' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: '还原缩放' })).toBeTruthy();
    for (let index = 0; index < 10; index += 1) fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    expect(ganttCalendar.style.gridTemplateColumns).toContain('8px');
    fireEvent.click(screen.getByRole('button', { name: '还原缩放' }));
    expect(ganttCalendar.style.gridTemplateColumns).toBe(wideColumnStyle);
    fireEvent.wheel(ganttScroll, { deltaY: 100 });
    expect(ganttCalendar.style.gridTemplateColumns).toBe(wideColumnStyle);
    const smallPinch = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 80 });
    fireEvent(ganttScroll, smallPinch);
    expect(smallPinch.defaultPrevented).toBe(true);
    expect(ganttCalendar.style.gridTemplateColumns).toBe(wideColumnStyle);
    fireEvent.wheel(ganttScroll, { ctrlKey: true, deltaY: 100 });
    expect(ganttCalendar.style.gridTemplateColumns).not.toBe(initialColumnStyle);
    const oneGestureStyle = ganttCalendar.style.gridTemplateColumns;
    fireEvent.wheel(ganttScroll, { ctrlKey: true, deltaY: 400 });
    expect(ganttCalendar.style.gridTemplateColumns).toBe(oneGestureStyle);
    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    const pinchStartStyle = ganttCalendar.style.gridTemplateColumns;
    fireEvent.touchStart(ganttScroll, { touches: [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(ganttScroll, { touches: [{ clientX: 120, clientY: 110 }, { clientX: 220, clientY: 110 }] });
    expect(ganttCalendar.style.gridTemplateColumns).toBe(pinchStartStyle);
    fireEvent.touchMove(ganttScroll, { touches: [{ clientX: 100, clientY: 100 }, { clientX: 250, clientY: 100 }] });
    expect(ganttCalendar.style.gridTemplateColumns).not.toBe(pinchStartStyle);
    const pinchOneStepStyle = ganttCalendar.style.gridTemplateColumns;
    fireEvent.touchMove(ganttScroll, { touches: [{ clientX: 0, clientY: 100 }, { clientX: 500, clientY: 100 }] });
    expect(ganttCalendar.style.gridTemplateColumns).not.toBe(pinchOneStepStyle);
    expect(ganttCalendar.style.gridTemplateColumns).toContain('38px');
    fireEvent.touchEnd(ganttScroll, { touches: [] });
    const ganttTrack = document.querySelector('.gantt-track') as HTMLElement;
    fireEvent.contextMenu(ganttTrack, { clientX: 0, button: 2 });
    expect(screen.getByRole('menuitem', { name: '插入时间点' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '插入时间点' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/work-items\/task-1$/), expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"estimate":1') })));
    const resizeHandle = screen.getByRole('separator', { name: '调整任务目录宽度' });
    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' });
    await waitFor(() => expect(localStorage.getItem('vibe-plan.task-directory-width')).toBe('484'));
    const assigneeTrigger = await waitFor(() => within(taskDirectory).getByRole('button', { name: '负责人 主任务' }));
    expect(assigneeTrigger.textContent).toContain('未分配');
    expect(assigneeTrigger.querySelector('.task-assignee-caret')).toBeNull();
    fireEvent.click(assigneeTrigger);
    expect(within(taskDirectory).getByRole('menu', { name: '主任务 负责人选项' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(within(taskDirectory).queryByRole('menu', { name: '主任务 负责人选项' })).toBeNull();
    fireEvent.click(assigneeTrigger);
    fireEvent.click(within(taskDirectory).getByRole('menuitem', { name: '王明' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/work-items\/task-1$/), expect.objectContaining({ method: 'PATCH' })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/work-items\/task-2$/), expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"assigneeId":"user-1"') })));
    fireEvent.click(within(taskDirectory).getByRole('button', { name: '收起 主任务' }));
    expect(within(taskDirectory).queryByRole('button', { name: /子任务/ })).toBeNull();
    fireEvent.click(within(taskDirectory).getByRole('button', { name: '展开 主任务' }));
    const childTaskButton = within(taskDirectory).getByRole('button', { name: '子任务 已完成 · bug · P2' });
    expect(childTaskButton.querySelector('.task-meta-status')?.classList.contains('status-done')).toBe(true);
    expect(childTaskButton.querySelector('.task-meta-progress')?.classList.contains('type-bug')).toBe(true);
    expect(childTaskButton.querySelector('.task-meta-progress')?.classList.contains('progress-complete')).toBe(true);
    fireEvent.click(within(taskDirectory).getByRole('button', { name: /主任务 进行中/ }));
    fireEvent.click(screen.getByRole('tab', { name: '任务详情' }));
    expect(screen.getByRole('complementary', { name: '任务目录' })).toBe(taskDirectory);
    expect(document.querySelector('.task-workspace-detail')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '主任务' })).toBeTruthy();
    expect(screen.getByText('描述')).toBeTruthy();
    expect(screen.getByText('完成度')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '主任务' })).toBeTruthy();
    expect(document.querySelector('.task-detail-summary-title .priority')?.textContent).toBe('P1');
    expect(document.querySelector('.task-detail-summary-meta')?.textContent).toContain('类型：功能开发');
    expect(document.querySelector('.task-detail-summary-meta')?.textContent).toContain('预估工时：未设置');
    expect(document.querySelector('.task-summary-secondary-meta')).toBeNull();
    expect(screen.getAllByText('40%').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: '验收' }));
    expect(screen.getByText('通过验收检查')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '验收标准' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回项目列表' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '项目管理' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('updates the task schedule optimistically and rolls it back when saving fails', async () => {
    const task = { id: 'task-1', title: '拖动调整时间', type: 'feature', status: 'in_progress', priority: 'P1', progress: 40, dueDate: '2026-09-30', estimate: 1, parentId: null, version: 1 };
    let rejectPatch: ((reason?: unknown) => void) | undefined;
    const patchPending = new Promise<never>((_, reject) => { rejectPatch = reject; });
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/work-items/task-1') && init?.method === 'PATCH') return patchPending;
      return { ok: true, json: async () => [task] };
    });
    vi.stubGlobal('fetch', fetchMock);
    const messages: string[] = [];
    const onMessage = (event: Event) => messages.push((event as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener(messageEvent, onMessage);
    render(<ProjectManagementPage projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]} activeProjectId="project-1" onBack={vi.fn()} onSelectProject={vi.fn()} />);
    const taskDirectory = await waitFor(() => screen.getByRole('complementary', { name: '任务目录' }));
    fireEvent.click(within(taskDirectory).getByRole('button', { name: '设置日期 拖动调整时间' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-02' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-04' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(within(taskDirectory).getByText('10月2日')).toBeTruthy());
    expect(within(taskDirectory).getByText('10月4日')).toBeTruthy();
    rejectPatch?.(new Error('服务器保存失败'));
    await waitFor(() => expect(messages).toContain('网络连接失败，请检查网络后重试。'));
    expect(within(taskDirectory).getAllByText('9月30日')).toHaveLength(2);
    window.removeEventListener(messageEvent, onMessage);
  });

  it('opens the child-task form from a task row menu', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/teams/team-1/members')) return { ok: true, json: async () => [] };
      if (path.endsWith('/projects/project-1/events')) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => [{ id: 'task-1', title: '主任务', type: 'feature', status: 'ready', priority: 'P1', progress: 0, dueDate: '2026-10-20', estimate: 2, parentId: null, version: 1 }] };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectManagementPage projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]} activeProjectId="project-1" onBack={vi.fn()} onSelectProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '任务操作 主任务' })).toBeTruthy());
    fireEvent.contextMenu(screen.getByRole('button', { name: '主任务 待开始 · feature · P1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '新建子任务' }));
    expect(screen.getByRole('heading', { name: '新建子任务' })).toBeTruthy();
    expect(screen.getByText('父任务：主任务')).toBeTruthy();
  });

  it('records a per-criterion acceptance result with comment and evidence', async () => {
    const task = {
      id: 'task-1', title: '验收任务', type: 'feature', status: 'in_review', priority: 'P1', progress: 90, parentId: null, version: 3,
      acceptanceCriteria: ['健康检查返回 200'],
      acceptanceItems: [{ id: '11111111-1111-4111-8111-111111111111', text: '健康检查返回 200', required: true, status: 'unverified', comment: '', evidence: [], reviewedBy: null, reviewedAt: null }],
    };
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/teams/team-1/members') || path.endsWith('/projects/project-1/events') || path.endsWith('/work-items/task-1/events')) return { ok: true, json: async () => [] };
      if (path.endsWith('/work-items/task-1/acceptance-items/11111111-1111-4111-8111-111111111111') && init?.method === 'PATCH') return { ok: true, json: async () => ({ ...task, version: 4, acceptanceItems: [{ ...task.acceptanceItems[0], status: 'failed', comment: '接口返回 500', evidence: [{ label: '测试记录', url: 'https://example.com/test-log' }], reviewedBy: 'user-1', reviewedAt: '2026-10-02T08:00:00.000Z' }] }) };
      if (path.endsWith('/work-items/task-1/permissions')) return { ok: true, json: async () => ({ canReview: true, canContribute: true }) };
      return { ok: true, json: async () => [task] };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectManagementPage projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]} activeProjectId="project-1" onBack={vi.fn()} onSelectProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '验收任务 待审核 · feature · P1' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '验收任务 待审核 · feature · P1' }));
    fireEvent.click(screen.getByRole('tab', { name: '任务详情' }));
    fireEvent.click(screen.getByRole('tab', { name: '验收' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '提交验收项 健康检查返回 200' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false));
    expect(screen.queryByRole('combobox', { name: '验收状态 健康检查返回 200' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '不通过' }));
    fireEvent.change(screen.getByLabelText('验收评论 健康检查返回 200'), { target: { value: '接口返回 500' } });
    fireEvent.change(screen.getByLabelText('证据链接 健康检查返回 200'), { target: { value: 'https://example.com/test-log' } });
    fireEvent.click(screen.getByRole('button', { name: '提交验收项 健康检查返回 200' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/work-items\/task-1\/acceptance-items\/11111111-1111-4111-8111-111111111111$/), expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ version: 3, status: 'failed', comment: '接口返回 500', evidence: [{ label: '证据链接', url: 'https://example.com/test-log' }] }),
    })));
    expect(screen.getByText('不通过')).toBeTruthy();
    expect((screen.getByLabelText('验收评论 健康检查返回 200') as HTMLInputElement).value).toBe('接口返回 500');
  });

  it('opens an edit form from a task row menu with the current task values', async () => {
    const task = { id: 'task-1', title: '测试任务', type: 'feature', status: 'ready', priority: 'P2', progress: 25, dueDate: '2026-10-05', estimate: 3, description: '已有描述', acceptanceCriteria: ['已有验收标准'], parentId: null, version: 2 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [task] }));
    render(<ProjectManagementPage projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]} activeProjectId="project-1" onBack={vi.fn()} onSelectProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '任务操作 测试任务' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '任务操作 测试任务' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }));
    expect(screen.getByRole('heading', { name: '编辑任务' })).toBeTruthy();
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('测试任务');
    expect((screen.getByLabelText('描述') as HTMLTextAreaElement).value).toBe('已有描述');
    expect((screen.getByLabelText('验收标准 1') as HTMLInputElement).value).toBe('已有验收标准');
  });

  it('deletes a task directly from its row menu', async () => {
    const task = { id: 'task-1', title: '测试任务', type: 'feature', status: 'ready', priority: 'P2', progress: 0, parentId: null, version: 2 };
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/work-items/task-1') && init?.method === 'DELETE') return { ok: true, json: async () => ({ status: 'deleted', deletedIds: ['task-1'] }) };
      return { ok: true, json: async () => [task] };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectManagementPage projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]} activeProjectId="project-1" onBack={vi.fn()} onSelectProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '任务操作 测试任务' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '任务操作 测试任务' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(screen.queryByRole('dialog', { name: '删除任务' })).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/work-items\/task-1$/), expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ version: 2 }) })));
  });

  it('refreshes project management tasks when the server emits a work-item event', async () => {
    class TestEventSource {
      static instances: TestEventSource[] = [];
      private readonly listeners = new Map<string, () => void>();
      constructor(readonly url: string) { TestEventSource.instances.push(this); }
      addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
      close() {}
      emit(type: string) { this.listeners.get(type)?.(); }
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'task-1', title: '任务', type: 'feature', status: 'ready', priority: 'P2', progress: 0, parentId: null, version: 1 }] });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', TestEventSource);
    render(<ProjectManagementPage projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]} activeProjectId="project-1" onBack={vi.fn()} onSelectProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '任务 待开始 · feature · P2' })).toBeTruthy());
    const taskRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/projects/project-1/work-items'));
    expect(TestEventSource.instances).toHaveLength(1);
    expect(TestEventSource.instances[0].url).toMatch(/\/projects\/project-1\/events\/stream$/);
    const requestCount = taskRequests().length;
    TestEventSource.instances[0].emit('work-item');
    await waitFor(() => expect(taskRequests()).toHaveLength(requestCount + 1));
  });

  it('opens member contribution statistics for the current project', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/teams/team-1/members')) return { ok: true, json: async () => [{ userId: 'user-1', displayName: '王明', email: 'wang@example.com', role: 'member' }] };
      return { ok: true, json: async () => [{ id: 'task-1', title: '实现功能', type: 'feature', status: 'in_progress', priority: 'P1', progress: 40, estimate: 5, assigneeId: 'user-1', parentId: null, version: 1 }] };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectManagementPage projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]} activeProjectId="project-1" onBack={vi.fn()} onSelectProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '成员贡献' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '成员贡献' }));
    const dialog = screen.getByRole('dialog', { name: '成员贡献统计' });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText('王明')).toBeTruthy();
    expect(within(dialog).getByText('1 个任务')).toBeTruthy();
    expect(within(dialog).getByText('40%')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '成员贡献统计' })).toBeNull();
  });

  it('splits contribution when a task changes owner mid-progress', async () => {
    const events = [
      { workItemId: 'task-1', action: 'created', payload: { assigneeId: 'user-a', progress: 10 }, createdAt: '2026-09-01T00:00:00.000Z' },
      { workItemId: 'task-1', action: 'updated', payload: { previousAssigneeId: 'user-a', newAssigneeId: 'user-b', handoffProgress: 30, resultProgress: 30 }, createdAt: '2026-09-02T00:00:00.000Z' },
      { workItemId: 'task-1', action: 'updated', payload: { status: 'done', resultProgress: 100 }, createdAt: '2026-09-03T00:00:00.000Z' },
    ];
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/teams/team-1/members')) return { ok: true, json: async () => [{ userId: 'user-a', displayName: '成员甲', email: 'a@example.com', role: 'member' }, { userId: 'user-b', displayName: '成员乙', email: 'b@example.com', role: 'member' }] };
      if (path.endsWith('/projects/project-1/events')) return { ok: true, json: async () => events };
      return { ok: true, json: async () => [{ id: 'task-1', title: '交接任务', type: 'feature', status: 'done', priority: 'P1', progress: 100, estimate: 5, assigneeId: 'user-b', parentId: null, version: 4 }] };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectManagementPage projects={[{ id: 'project-1', name: '项目一', slug: 'project-1', teamId: 'team-1' }]} activeProjectId="project-1" onBack={vi.fn()} onSelectProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '成员贡献' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '成员贡献' }));
    const dialog = screen.getByRole('dialog', { name: '成员贡献统计' });
    expect(within(dialog).getByText('成员甲')).toBeTruthy();
    expect(within(dialog).getByText('成员乙')).toBeTruthy();
    expect(within(dialog).getByText('1.5 天')).toBeTruthy();
    expect(within(dialog).getByText('3.5 天')).toBeTruthy();
  });

  it('selects the first team when teams load after opening the project modal', async () => {
    const props = { teams: [], projects: [], onChanged: vi.fn(), onOpen: vi.fn() };
    const { rerender } = render(<ProjectsPage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '新增项目' }));
    rerender(<ProjectsPage {...props} teams={[{ id: 'team-1', name: '研发', slug: 'dev' }]} />);
    await waitFor(() => expect((screen.getByRole('button', { name: '创建项目' }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText('团队') as HTMLSelectElement).value).toBe('team-1');
  });

  it('opens the profile menu with organization switching and creation', () => {
    const onSelectOrganization = vi.fn();
    const onCreateOrganization = vi.fn();
    render(<ProfileMenu user={{ id: 'user-1', email: 'user@example.com', displayName: '用户' }} organizations={[{ id: 'org-1', name: '甲组织', slug: 'org-1' }, { id: 'org-2', name: '乙组织', slug: 'org-2' }]} organizationId="org-1" onSelectOrganization={onSelectOrganization} onCreateOrganization={onCreateOrganization} />);
    fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
    expect(screen.getByRole('menuitem', { name: '个人资料' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '乙组织' }));
    expect(onSelectOrganization).toHaveBeenCalledWith('org-2');
    fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '新建组织' }));
    expect(onCreateOrganization).toHaveBeenCalledTimes(1);
  });

  it('logs out from the profile menu and clears the server session', async () => {
    const onLogout = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'signed_out' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProfileMenu user={{ id: 'user-1', email: 'user@example.com' }} organizations={[]} organizationId="" onSelectOrganization={vi.fn()} onCreateOrganization={vi.fn()} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/logout$/), expect.objectContaining({ method: 'POST', credentials: 'include' })));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('saves an updated display name from the profile dialog', async () => {
    const onProfileUpdated = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'user-1', email: 'user@example.com', displayName: '新名称' }) }));
    render(<ProfileMenu user={{ id: 'user-1', email: 'user@example.com' }} organizations={[]} organizationId="" onSelectOrganization={vi.fn()} onCreateOrganization={vi.fn()} onProfileUpdated={onProfileUpdated} />);
    fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '个人资料' }));
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '新名称' } });
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));
    await waitFor(() => expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ displayName: '新名称' })));
  });

  it('approves a CLI device from the profile menu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'approved' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProfileMenu user={{ id: 'user-1', email: 'user@example.com' }} organizations={[]} organizationId="" onSelectOrganization={vi.fn()} onCreateOrganization={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CLI 设备授权' }));
    expect(screen.getByRole('heading', { name: 'CLI 设备授权' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('CLI 设备码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '批准设备' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/device\/approve$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ userCode: '123456' }) })));
    expect(screen.getByText('设备已批准，CLI 登录成功。')).toBeTruthy();
    expect(screen.queryByLabelText('CLI 设备码')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(screen.queryByRole('dialog', { name: 'CLI 设备授权' })).toBeNull();
  });

  it('guides users without an organization to create one', () => {
    render(<ProfileMenu user={{ id: 'user-2', email: 'new@example.com' }} organizations={[]} organizationId="" onSelectOrganization={vi.fn()} onCreateOrganization={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
    expect(screen.getByText('先新建组织')).toBeTruthy();
  });

  it('keeps creation forms free of internal identifiers and hides Git configuration', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<ProjectsPage teams={[{ id: 'team-1', name: '研发', slug: 'dev' }]} projects={[]} onChanged={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增项目' }));
    expect(screen.queryByLabelText('项目标识')).toBeNull();
    expect(screen.queryByLabelText('Git 地址')).toBeNull();
    expect(screen.getByLabelText('项目描述')).toBeTruthy();
  });
});
