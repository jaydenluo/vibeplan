/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TaskActivity, TaskCodeRelations } from './TaskProjectTabs.js';

const item = { id: 'task-1', title: '实现接口', type: 'feature', status: 'in_progress', priority: 'P1', progress: 40, version: 1, parentId: null, dependsOn: ['task-2'] };

it('shows the task tree, dependency status, and opens a selected task', () => {
  const onSelect = vi.fn();
  const dependency = { id: 'task-2', title: '准备接口契约', type: 'feature', status: 'done', priority: 'P2', progress: 100, version: 1, parentId: null, dependsOn: [] };
  const child = { id: 'task-3', title: '补充接口测试', type: 'test', status: 'ready', priority: 'P2', progress: 0, version: 1, parentId: 'task-1', dependsOn: [] };
  render(<TaskCodeRelations project={{ id: 'project', name: '项目', repositoryUrl: 'https://example.com/repo' }} items={[item, dependency, child]} onSelect={onSelect} />);
  expect(screen.getByRole('heading', { name: '任务关系' })).toBeTruthy();
  expect(screen.getByText('打开代码仓库 ↗')).toBeTruthy();
  expect(screen.getByText('补充接口测试')).toBeTruthy();
  expect(screen.getByText('依赖已满足')).toBeTruthy();
  expect(screen.getByText('仓库已配置，提交与任务的自动关联尚未建立。')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: /实现接口/ })[0]);
  expect(onSelect).toHaveBeenCalledWith(item);
});

it('lists project activities newest first and opens its task', () => {
  const onSelect = vi.fn();
  render(<TaskActivity items={[item]} events={[{ workItemId: 'task-1', action: 'updated', actorId: 'user-1', payload: { summary: '进度更新' }, createdAt: '2026-10-01T00:00:00Z' }, { workItemId: 'task-1', action: 'created', actorId: 'user-1', payload: {}, createdAt: '2026-09-01T00:00:00Z' }]} loading={false} error="" onSelect={onSelect} />);
  const activityPanel = screen.getByRole('region', { name: '活动记录' });
  expect(within(activityPanel).getByText('进度更新')).toBeTruthy();
  const firstActivity = within(activityPanel).getAllByRole('button')[0];
  expect(firstActivity.textContent).toContain('更新任务');
  fireEvent.click(firstActivity);
  expect(onSelect).toHaveBeenCalledWith(item);
});
