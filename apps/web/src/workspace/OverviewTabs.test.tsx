/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkspacePage } from './WorkspacePage.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState({}, '', '/'); });

function setup() {
  const task = { id: 'task', projectId: 'project', projectName: 'Vibe Plan', title: '可开始的演示任务', status: 'ready', priority: 'P2', dueDate: null, reason: '前置任务已完成' };
  localStorage.setItem('vibe-plan.organization', 'org');
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string) => {
    const payload = input.endsWith('/auth/me') ? { id: 'user', email: 'reader@example.test' }
      : input.endsWith('/organizations') ? [{ id: 'org', name: '演示组织', slug: 'org' }]
        : input.endsWith('/my-work') ? { inProgress: [], ready: [task], blocked: [], inReview: [], next: task }
          : input.endsWith('/overview') ? { summary: { projectCount: 0, taskCount: 0, averageProgress: 0, inProgressCount: 0, inReviewCount: 0, blockedCount: 0, overdueCount: 0, staleCount: 0 }, statusDistribution: [], completionTrend: [], projects: [] }
            : [];
    return { ok: true, json: async () => payload };
  }));
}

it('shows workbench and today work as mutually exclusive tabs while preserving category selection', async () => {
  setup();
  window.history.replaceState({}, '', '/overview');
  render(<WorkspacePage />);
  const tabs = within(screen.getByRole('tablist', { name: '总览视图' }));
  expect(tabs.getByRole('tab', { name: '工作台' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('heading', { name: '工作台' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '今日工作' })).toBeNull();
  fireEvent.click(tabs.getByRole('tab', { name: '今日工作' }));
  expect(screen.getByRole('heading', { name: '今日工作' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '工作台' })).toBeNull();
  await screen.findByRole('tab', { name: '可开始 1' });
  fireEvent.click(screen.getByRole('tab', { name: '已阻塞 0' }));
  fireEvent.click(tabs.getByRole('tab', { name: '工作台' }));
  fireEvent.click(tabs.getByRole('tab', { name: '今日工作' }));
  expect(screen.getByRole('tab', { name: '已阻塞 0', selected: true })).toBeTruthy();
  expect(window.location.search).toBe('?tab=today');
});

it('restores the today tab from the URL and follows browser back and forward', async () => {
  setup();
  window.history.replaceState({}, '', '/overview?tab=today');
  render(<WorkspacePage />);
  const tabs = within(screen.getByRole('tablist', { name: '总览视图' }));
  expect(tabs.getByRole('tab', { name: '今日工作', selected: true })).toBeTruthy();
  fireEvent.click(tabs.getByRole('tab', { name: '工作台' }));
  expect(window.location.search).toBe('');
  window.history.back();
  await waitFor(() => expect(tabs.getByRole('tab', { name: '今日工作', selected: true })).toBeTruthy());
  window.history.forward();
  await waitFor(() => expect(tabs.getByRole('tab', { name: '工作台', selected: true })).toBeTruthy());
});

it('supports keyboard navigation and associates each tab with its panel', () => {
  setup();
  render(<WorkspacePage />);
  const tabs = within(screen.getByRole('tablist', { name: '总览视图' }));
  const first = tabs.getByRole('tab', { name: '工作台' });
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const today = tabs.getByRole('tab', { name: '今日工作', selected: true });
  expect(document.activeElement).toBe(today);
  expect(document.getElementById(today.getAttribute('aria-controls')!)?.hidden).toBe(false);
  fireEvent.keyDown(today, { key: 'Home' });
  expect(first.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(first);
});
