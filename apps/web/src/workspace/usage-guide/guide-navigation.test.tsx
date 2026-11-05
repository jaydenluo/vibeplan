/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkspacePage } from '../WorkspacePage.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState({}, '', '/'); });

it('opens the tutorial without organizations and handles menu state, direct routing and history', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string) => ({ ok: true, json: async () => input.endsWith('/auth/me') ? { id: 'reader', email: 'reader@example.com' } : [] })));
  window.history.replaceState({}, '', '/guide');
  render(<WorkspacePage />);
  expect(await screen.findByRole('heading', { name: 'Vibe Plan 使用指南' })).toBeTruthy();
  const nav = screen.getByRole('navigation', { name: '主导航' });
  const buttons = within(nav).getAllByRole('button');
  expect(buttons.findIndex(b => b.getAttribute('aria-label') === '使用教程')).toBe(buttons.findIndex(b => b.getAttribute('aria-label') === '待办审批') + 1);
  expect(screen.getByRole('button', { name: '使用教程' }).className).toBe('selected');
  fireEvent.click(screen.getByRole('button', { name: '展开菜单' }));
  expect(within(nav).getByText('使用教程')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '项目管理' }));
  expect(window.location.pathname).toBe('/projects');
  window.history.back();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Vibe Plan 使用指南' })).toBeTruthy());
  window.history.forward();
  await waitFor(() => expect(window.location.pathname).toBe('/projects'));
});
