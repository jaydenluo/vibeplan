/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectManagementPage } from './ProjectManagementPage.js';
import { messageEvent } from '../api/client.js';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

it('collapses the project directory into an icon rail and restores it', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  render(<ProjectManagementPage projects={[
    { id: 'one', name: '项目一', slug: 'one', teamId: 'team' },
    { id: 'two', name: '项目二', slug: 'two', teamId: 'team' },
  ]} activeProjectId="one" onBack={vi.fn()} onSelectProject={vi.fn()} />);

  await waitFor(() => expect(screen.getByRole('complementary', { name: '项目目录' })).toBeTruthy());
  expect(screen.getByRole('heading', { name: '项目管理' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收起项目目录' }));
  expect(screen.getByRole('complementary', { name: '项目目录' }).classList.contains('collapsed')).toBe(true);
  expect(screen.getByRole('button', { name: '项目二' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '展开项目目录' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '展开项目目录' }).querySelector('svg')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '展开项目目录' }));
  expect(screen.getByRole('complementary', { name: '项目目录' }).classList.contains('collapsed')).toBe(false);
});

it('copies a task prompt for Vibe from the task action menu', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const item = {
    id: 'task', title: '复制到 Vibe 的任务', type: 'feature', status: 'in_progress', priority: 'P1', version: 1,
    description: '将任务信息整理为可执行提示词。', dueDate: '2026-10-20', estimate: 3, parentId: null,
    acceptanceCriteria: ['可直接粘贴使用'],
  };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/work-items')) return { ok: true, json: async () => [item] };
    if (path.endsWith('/health')) return { ok: false, json: async () => ({}) };
    if (path.endsWith('/members')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [] };
  }));

  const messages: string[] = [];
  const onMessage = (event: Event) => messages.push((event as CustomEvent<{ text: string }>).detail.text);
  window.addEventListener(messageEvent, onMessage);
  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '任务操作 复制到 Vibe 的任务' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '任务操作 复制到 Vibe 的任务' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '复制任务去Vibe' }));

  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('复制到 Vibe 的任务')));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('任务 ID：task'));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('请先从 Vibe Plan 获取该任务的完整信息'));
  expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('类型：'));
  expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('验收标准：'));
  await waitFor(() => expect(messages).toContain('复制成功，请粘贴到AI编辑工具使用。'));
  window.removeEventListener(messageEvent, onMessage);
});

it('opens a task query directly and retains the selection on refresh', async () => {
  window.history.replaceState({}, '', '/projects/project?task=task');
  const item = {
    id: 'task',
    title: '直接打开任务',
    type: 'feature',
    status: 'in_progress',
    priority: 'P2',
    version: 1,
    description: '任务详情证据',
    dueDate: '2026-10-04',
    estimate: 3,
    riskFlags: ['behind_schedule'],
    acceptanceItems: [{
      id: 'acceptance-1',
      text: '状态更新可实时显示',
      required: true,
      status: 'unverified',
      comment: '',
      evidence: [],
      reviewedBy: null,
      reviewedAt: null,
    }],
  };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/work-items')) return { ok: true, json: async () => [item] };
    if (path.endsWith('/permissions')) return { ok: true, json: async () => ({ canContribute: false, canReview: false }) };
    if (path.endsWith('/health')) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => [] };
  }));
  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('任务详情证据')).toBeTruthy());
  expect(screen.getByRole('tab', { name: '任务详情' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: '计划' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: '验收' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: '执行记录' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: '依赖与历史' })).toBeTruthy();
  expect(screen.getByText('继续执行并补齐 1 项验收标准的证据。')).toBeTruthy();
  const executionGuide = screen.getByText('下一步').closest('.task-execution-guide');
  expect(executionGuide).toBeTruthy();
  expect(within(executionGuide as HTMLElement).getByText('进度落后')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /验收标准.*0\/1 已通过/ })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '验收' }));
  expect(screen.getByRole('heading', { name: '验收标准' })).toBeTruthy();
  expect(screen.getByText('状态更新可实时显示')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '设置日期 直接打开任务' }));
  expect(screen.getByRole('dialog', { name: '设置日期 直接打开任务' })).toBeTruthy();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('dialog', { name: '设置日期 直接打开任务' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy());
});

it('switches task detail tabs and keeps the active tab scoped to one content group', async () => {
  const item = {
    id: 'task', title: '分组任务', type: 'feature', status: 'in_progress', priority: 'P2', version: 1,
    description: '任务描述', planMarkdown: '# 执行计划\n\n1. 完成实现', acceptanceCriteria: ['验收通过'],
    dueDate: '2026-10-04', estimate: 2, parentId: null,
  };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/work-items')) return { ok: true, json: async () => [item] };
    if (path.endsWith('/permissions')) return { ok: true, json: async () => ({ canContribute: false, canReview: false }) };
    if (path.endsWith('/events')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [] };
  }));
  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getAllByText('分组任务').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('button', { name: '分组任务 进行中 · feature · P2' }));
  fireEvent.click(screen.getByRole('tab', { name: '任务详情' }));

  fireEvent.click(screen.getByRole('tab', { name: '计划' }));
  expect(screen.getByRole('tab', { name: '计划' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('执行计划')).toBeTruthy();
  expect(screen.queryByText('任务描述')).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));
  expect(screen.getByRole('heading', { name: '工作记录' })).toBeTruthy();
  expect(screen.getByText('当前执行状态')).toBeTruthy();
  expect(screen.getByText('提交执行报告')).toBeTruthy();
  expect(screen.getByText('执行历史')).toBeTruthy();
  expect(screen.queryByText('交付与验收')).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: '依赖与历史' }));
  expect(screen.getByText('依赖关系')).toBeTruthy();
  expect(screen.getByText('任务变更历史')).toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: '概览' }));
  expect(screen.getByText('任务描述')).toBeTruthy();
  expect(screen.getByText('描述')).toBeTruthy();
});

it('keeps the selected detail tab when switching to another task', async () => {
  const items = [
    { id: 'task-1', title: '第一个任务', type: 'feature', status: 'ready', priority: 'P2', version: 1, planMarkdown: '# 计划一', parentId: null },
    { id: 'task-2', title: '第二个任务', type: 'feature', status: 'ready', priority: 'P2', version: 1, planMarkdown: '# 计划二', parentId: null },
  ];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/work-items')) return { ok: true, json: async () => items };
    if (path.endsWith('/permissions')) return { ok: true, json: async () => ({ canContribute: false, canReview: false }) };
    if (path.endsWith('/events')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [] };
  }));
  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '第一个任务 待开始 · feature · P2' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '第一个任务 待开始 · feature · P2' }));
  fireEvent.click(screen.getByRole('tab', { name: '任务详情' }));
  fireEvent.click(screen.getByRole('tab', { name: '计划' }));
  fireEvent.click(screen.getByRole('button', { name: '第二个任务 待开始 · feature · P2' }));
  expect(screen.getByRole('tab', { name: '计划' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText(/计划二/)).toBeTruthy();
});

it('keeps dependency cards passive until the explicit view action and saves from a modal', async () => {
  window.history.replaceState({}, '', '/projects/project?task=main');
  const main = { id: 'main', title: '主任务', type: 'feature', status: 'in_progress', priority: 'P2', version: 2, dependsOn: ['dep-1'], parentId: null };
  const dependency = { id: 'dep-1', title: '已有依赖', type: 'feature', status: 'ready', priority: 'P2', version: 1, progress: 20, parentId: null };
  const candidate = { id: 'dep-2', title: '待添加依赖', type: 'bug', status: 'done', priority: 'P2', version: 1, progress: 100, parentId: null };
  let saved = false;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/work-items')) return { ok: true, json: async () => [saved ? { ...main, dependsOn: ['dep-1', 'dep-2'], version: 3 } : main, dependency, candidate] };
    if (path.endsWith('/permissions')) return { ok: true, json: async () => ({ canContribute: false, canReview: false }) };
    if (path.endsWith('/events')) return { ok: true, json: async () => [] };
    if (path.endsWith('/dependencies') && init?.method === 'PUT') {
      saved = true;
      return { ok: true, json: async () => ({ ...main, dependsOn: ['dep-1', 'dep-2'], version: 3 }) };
    }
    return { ok: true, json: async () => [] };
  }));
  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('heading', { name: '主任务' })).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: '依赖与历史' }));
  expect(screen.getAllByText('已有依赖').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: '保存依赖' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '添加依赖' }));
  const dialog = screen.getByRole('dialog', { name: '添加依赖' });
  expect(dialog).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: /待添加依赖/ }));
  expect(screen.getByRole('button', { name: '保存依赖' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保存依赖' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加依赖' })).toBeNull());
  await waitFor(() => expect(screen.queryByRole('button', { name: '保存依赖' })).toBeNull());
  expect(screen.getAllByText('待添加依赖').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: '查看任务' })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: '查看任务' })[1]);
  await waitFor(() => expect(screen.getByRole('heading', { name: '待添加依赖' })).toBeTruthy());
});

it('removes a dependency locally and persists the remaining selection', async () => {
  window.history.replaceState({}, '', '/projects/project?task=main');
  const main = { id: 'main', title: '主任务', type: 'feature', status: 'in_progress', priority: 'P2', version: 2, dependsOn: ['dep-1', 'dep-2'], parentId: null };
  const dependency = { id: 'dep-1', title: '待移除依赖', type: 'feature', status: 'ready', priority: 'P2', version: 1, progress: 20, parentId: null };
  const remaining = { id: 'dep-2', title: '保留依赖', type: 'bug', status: 'done', priority: 'P2', version: 1, progress: 100, parentId: null };
  let savedDependsOn = main.dependsOn;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/work-items')) return { ok: true, json: async () => [{ ...main, dependsOn: savedDependsOn }, dependency, remaining] };
    if (path.endsWith('/permissions')) return { ok: true, json: async () => ({ canContribute: false, canReview: false }) };
    if (path.endsWith('/events')) return { ok: true, json: async () => [] };
    if (path.endsWith('/dependencies') && init?.method === 'PUT') {
      savedDependsOn = JSON.parse(String(init.body)).dependsOn;
      return { ok: true, json: async () => ({ ...main, dependsOn: savedDependsOn, version: 3 }) };
    }
    return { ok: true, json: async () => [] };
  }));
  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('heading', { name: '主任务' })).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: '依赖与历史' }));
  expect(screen.getAllByText('待移除依赖').length).toBeGreaterThan(0);
  const removableCard = screen.getAllByRole('article').find((card) => card.textContent?.includes('待移除依赖'));
  expect(removableCard).toBeTruthy();
  fireEvent.click(within(removableCard as HTMLElement).getByRole('button', { name: '移除依赖 待移除依赖' }));
  expect(screen.getAllByText('待移除依赖').length).toBe(1);
  expect(screen.getAllByText('保留依赖').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '保存依赖' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保存依赖' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '保存依赖' })).toBeNull());
  expect(savedDependsOn).toEqual(['dep-2']);
});

it('moves descendant schedules optimistically with a parent gantt bar', async () => {
  const items = [
    { id: 'parent', title: '父任务', type: 'feature', status: 'in_progress', priority: 'P1', version: 1, dueDate: '2026-10-10', estimate: 2, parentId: null },
    { id: 'child', title: '子任务', type: 'feature', status: 'ready', priority: 'P2', version: 1, dueDate: '2026-10-09', estimate: 1, parentId: 'parent' },
  ];
  const patches: Array<{ id: string; body: Record<string, unknown> }> = [];
  let resolvePatches: (() => void) | undefined;
  const patchPending = new Promise<void>((resolve) => { resolvePatches = resolve; });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/work-items')) return { ok: true, json: async () => items };
    if (path.endsWith('/health')) return { ok: false, json: async () => ({}) };
    if (path.endsWith('/members')) return { ok: true, json: async () => [] };
    if (init?.method === 'PATCH') {
      const id = path.split('/').at(-1)!;
      const body = JSON.parse(String(init.body));
      patches.push({ id, body });
      await patchPending;
      return { ok: true, json: async () => ({ ...items.find((item) => item.id === id), ...body, version: 2 }) };
    }
    return { ok: true, json: async () => [] };
  }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 100, width: 1000, height: 100, toJSON: () => ({}) });

  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '父任务' })).toBeTruthy());
  const parentBar = screen.getByRole('button', { name: '父任务' });
  const parentLeftBeforeMove = parentBar.style.left;
  fireEvent.mouseDown(parentBar, { clientX: 100 });
  await waitFor(() => expect(document.querySelector('.gantt-track')).toBeTruthy());
  // The mock track is 1000px wide and the padded calendar spans 16 days.
  fireEvent.mouseMove(window, { clientX: 162.5 });
  await waitFor(() => expect((screen.getByRole('button', { name: '父任务' }) as HTMLButtonElement).style.left).not.toBe(parentLeftBeforeMove));
  fireEvent.mouseUp(window);

  expect((screen.getByRole('button', { name: '子任务' }) as HTMLButtonElement).style.left).toBe((screen.getByRole('button', { name: '父任务' }) as HTMLButtonElement).style.left);
  await waitFor(() => expect(patches).toEqual(expect.arrayContaining([
    { id: 'parent', body: expect.objectContaining({ dueDate: '2026-10-11', estimate: 2 }) },
    { id: 'child', body: expect.objectContaining({ dueDate: '2026-10-10', estimate: 1 }) },
  ])));
  resolvePatches?.();
});

it('extends the gantt date range by seven days from either lower corner control', async () => {
  const items = [{ id: 'task', title: '排期任务', type: 'feature', status: 'ready', priority: 'P2', version: 1, dueDate: '2026-10-10', estimate: 2, parentId: null }];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/work-items')) return { ok: true, json: async () => items };
    if (path.endsWith('/health')) return { ok: false, json: async () => ({}) };
    if (path.endsWith('/members')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [] };
  }));

  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '排期任务' })).toBeTruthy());
  const countDates = () => document.querySelectorAll('.gantt-calendar span').length;
  const initialCount = countDates();
  expect(document.querySelector('.gantt-calendar span')?.getAttribute('title')).toMatch(/^2026年\d+月\d+日 星期[日一二三四五六]$/);

  fireEvent.click(screen.getByRole('button', { name: '向前扩展 7 天' }));
  expect(countDates()).toBe(initialCount + 7);
  fireEvent.click(screen.getByRole('button', { name: '向后扩展 7 天' }));
  expect(countDates()).toBe(initialCount + 14);
});

it('keeps the task directory and gantt rows vertically synchronized', async () => {
  const items = [{ id: 'task', title: '同步排期任务', type: 'feature', status: 'ready', priority: 'P2', version: 1, dueDate: '2026-10-10', estimate: 2, parentId: null }];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/work-items')) return { ok: true, json: async () => items };
    if (path.endsWith('/health')) return { ok: false, json: async () => ({}) };
    if (path.endsWith('/members')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [] };
  }));

  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '同步排期任务' })).toBeTruthy());
  const directory = screen.getByRole('complementary', { name: '任务目录' });
  const ganttPanel = document.querySelector<HTMLElement>('.task-workspace-gantt .task-view-panel');
  expect(ganttPanel).toBeTruthy();

  directory.scrollTop = 120;
  fireEvent.scroll(directory);
  expect(ganttPanel?.scrollTop).toBe(120);
  ganttPanel!.scrollTop = 240;
  fireEvent.scroll(ganttPanel!);
  expect(directory.scrollTop).toBe(240);
});
