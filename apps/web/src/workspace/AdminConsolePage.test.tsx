/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminConsolePage } from './AdminConsolePage.js';
import { WorkspacePage } from './WorkspacePage.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const superAdmin = { userId: 'admin-1', email: 'ops@example.com', role: 'super_admin' as const };
const operator = { userId: 'operator-1', email: 'reader@example.com', role: 'operator' as const };

function mockFetch(providerTransactionId: string | null = '2026101322001499') {
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/admin/overview')) return { ok: true, json: async () => ({ userCount: 120, organizationCount: 36, activeSubscriptionCount: 18, revenue30dCents: 128000, pendingOrderCount: 3 }) };
    if (path.includes('/admin/orders')) return { ok: true, json: async () => ({ items: [{ id: 'order-1', orderNo: 'VP202610130001', organizationName: '研发组织', purchaserEmail: 'owner@example.com', planCode: 'team_10', amountCents: 48000, status: 'pending', providerTransactionId, paidAt: providerTransactionId ? null : '2026-10-13T00:00:00.000Z', createdAt: '2026-10-13T00:00:00.000Z' }], nextCursor: null }) };
    if (path.includes('/admin/admins')) return { ok: true, json: async () => ({ items: [superAdmin] }) };
    if (path.includes('/admin/users') || path.includes('/admin/organizations')) return { ok: true, json: async () => ({ items: [], nextCursor: null }) };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('renders the operations overview for a confirmed administrator', async () => {
  mockFetch();
  render(<AdminConsolePage identity={superAdmin} />);
  await waitFor(() => expect(screen.getByText('120')).toBeTruthy());
  expect(screen.getByText('近 30 天付款')).toBeTruthy();
  expect(screen.getByText('¥1,280')).toBeTruthy();
});

it('filters order records on the server', async () => {
  const fetchMock = mockFetch();
  render(<AdminConsolePage identity={superAdmin} />);
  fireEvent.click(screen.getByRole('button', { name: '充值记录' }));
  await waitFor(() => expect(screen.getByText('VP202610130001')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('订单状态'), { target: { value: 'pending' } });
  fireEvent.click(screen.getByRole('button', { name: '查询订单' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/orders\?.*status=pending/), expect.anything()));
});

it('shows a compact copyable provider transaction ID', async () => {
  mockFetch();
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  Object.assign(navigator, { clipboard });
  render(<AdminConsolePage identity={superAdmin} />);
  fireEvent.click(screen.getByRole('button', { name: '充值记录' }));
  await waitFor(() => expect(screen.getByText('VP202610130001')).toBeTruthy());
  expect(screen.getByText('2026101322…1499')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '复制交易号 2026101322001499' }));
  expect(clipboard.writeText).toHaveBeenCalledWith('2026101322001499');
});

it('shows a dash when an order has no provider transaction ID', async () => {
  mockFetch(null);
  render(<AdminConsolePage identity={superAdmin} />);
  fireEvent.click(screen.getByRole('button', { name: '充值记录' }));
  await waitFor(() => expect(screen.getByText('VP202610130001')).toBeTruthy());
  expect(screen.getByText('—')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /复制交易号/ })).toBeNull();
});

it('withholds administrator mutations from operators', async () => {
  mockFetch();
  render(<AdminConsolePage identity={operator} />);
  fireEvent.click(screen.getByRole('button', { name: '管理员' }));
  await waitFor(() => expect(screen.getByRole('table', { name: '平台管理员' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: '授予管理员' })).toBeNull();
  expect(screen.queryByRole('button', { name: /撤销/ })).toBeNull();
  expect(screen.getByText('普通运营管理员只能查看管理员名单。')).toBeTruthy();
});

it('hides the admin menu and denies a direct admin route to ordinary users', async () => {
  window.history.replaceState({}, '', '/admin');
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return { ok: true, json: async () => ({ id: 'user-1', email: 'member@example.com' }) };
    if (path.endsWith('/admin/me')) return { ok: false, status: 403, json: async () => ({ error: { message: 'Platform administrator access is required.' } }) };
    return { ok: true, json: async () => [] };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<WorkspacePage />);
  await waitFor(() => expect(screen.getByRole('heading', { name: '无权访问管理后台' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: '管理后台' })).toBeNull();
  expect(fetchMock.mock.calls.some(([input]) => /\/admin\/(overview|users|organizations|orders|admins)/.test(String(input)))).toBe(false);
});

it('shows the admin menu only after the server confirms platform access', async () => {
  window.history.replaceState({}, '', '/overview');
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return { ok: true, json: async () => ({ id: 'admin-1', email: 'ops@example.com' }) };
    if (path.endsWith('/admin/me')) return { ok: true, json: async () => superAdmin };
    return { ok: true, json: async () => [] };
  }));
  render(<WorkspacePage />);
  await waitFor(() => expect(screen.getByRole('button', { name: '管理后台' })).toBeTruthy());
});
