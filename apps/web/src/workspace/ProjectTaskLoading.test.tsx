/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectManagementPage } from './ProjectManagementPage.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState({}, '', '/'); });

const projects = ['one', 'two'].map(id => ({ id, name: `项目 ${id}`, slug: id, teamId: 'team' }));
const item = { id: 'task', title: '加载后的任务', type: 'feature', status: 'ready', priority: 'P2', estimate: 1, dueDate: '2026-11-06' };
const response = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
function deferred() {
  let resolve!: (data: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(loadTasks: (path: string) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    return path.endsWith('/work-items') ? loadTasks(path) : response(path.endsWith('/health') ? null : []);
  }));
}
function page(activeProjectId = 'one', list = projects) {
  return <ProjectManagementPage projects={list} activeProjectId={activeProjectId} onBack={vi.fn()} onSelectProject={vi.fn()} />;
}
function expectLoading() {
  expect(screen.getAllByRole('status', { name: '任务加载中' })).toHaveLength(2);
  expect(screen.queryByText('暂无任务。')).toBeNull();
  expect(screen.queryByText('这个项目还没有任务，点击右上角新建任务。')).toBeNull();
}

it('shows loading in both panes until tasks arrive, including while project metadata is pending', async () => {
  const pending = deferred();
  setup(() => pending.promise);
  const view = render(page('one', []));
  expectLoading();
  view.rerender(page());
  expectLoading();
  await act(async () => pending.resolve(response([item])));
  await screen.findByRole('button', { name: `任务操作 ${item.title}` });
  expect(screen.queryAllByRole('status', { name: '任务加载中' })).toHaveLength(0);
});

it('shows empty messages only after an empty response completes', async () => {
  const pending = deferred();
  setup(() => pending.promise);
  render(page());
  expectLoading();
  await act(async () => pending.resolve(response([])));
  await screen.findByText('暂无任务。');
  expect(screen.getByText('这个项目还没有任务，点击右上角新建任务。')).toBeTruthy();
  expect(screen.queryAllByRole('status', { name: '任务加载中' })).toHaveLength(0);
});

it('shows a retryable failure instead of an empty project and loads on retry', async () => {
  const pending = deferred();
  let retried = false;
  setup(() => retried ? response([item]) : pending.promise);
  render(page());
  expectLoading();
  await act(async () => pending.resolve(response({ error: { code: 'INTERNAL_ERROR' } }, false)));
  await waitFor(() => expect(screen.getAllByText('任务加载失败，请重试。')).toHaveLength(2));
  expect(screen.queryByText('暂无任务。')).toBeNull();
  expect(screen.queryAllByRole('status', { name: '任务加载中' })).toHaveLength(0);
  retried = true;
  fireEvent.click(screen.getAllByRole('button', { name: '重试加载任务' })[0]!);
  await screen.findByRole('button', { name: `任务操作 ${item.title}` });
});

it('keeps the current project loading when an earlier project request finishes', async () => {
  const first = deferred();
  const second = deferred();
  setup(path => path.includes('/one/') ? first.promise : second.promise);
  const view = render(page());
  view.rerender(page('two'));
  expectLoading();
  await act(async () => first.resolve(response([item])));
  expectLoading();
  expect(screen.queryByRole('button', { name: `任务操作 ${item.title}` })).toBeNull();
  await act(async () => second.resolve(response([])));
  await screen.findByText('暂无任务。');
});

it('keeps loaded rows mounted during a background refresh', async () => {
  const pending = deferred();
  let refreshing = false;
  setup(() => refreshing ? pending.promise : response([item]));
  render(page());
  const row = await screen.findByRole('button', { name: `任务操作 ${item.title}` });
  refreshing = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(screen.getByRole('button', { name: `任务操作 ${item.title}` })).toBe(row);
  expect(screen.queryAllByRole('status', { name: '任务加载中' })).toHaveLength(0);
  await act(async () => pending.resolve(response([item])));
});
