/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BillingSummary } from '../api/client.js';
import { messageEvent } from '../api/client.js';
import { BillingPage } from './BillingPage.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const summary: BillingSummary = {
  organizationId: 'org-1',
  role: 'owner',
  subscription: { planCode: 'team_10', status: 'active', periodEndsAt: '2027-10-13T00:00:00.000Z', graceEndsAt: '2027-10-20T00:00:00.000Z' },
  policy: { canWriteOrganization: true, canCreateProject: true, canManageMembers: true, canManageBilling: true, memberUsage: 3, memberLimit: 10, projectUsage: 12, projectLimit: null, denialReason: null },
  orders: [{ id: 'order-1', orderNo: 'VP202610130001', planCode: 'team_10', amountCents: 48000, status: 'paid', paidAt: '2026-10-13T00:00:00.000Z' }],
};

function mockFetch(payload = summary) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
}

it('shows the organization plan, seat usage, and payment history', async () => {
  mockFetch();
  render(<BillingPage organizationId="org-1" organizationName="研发组织" />);
  await waitFor(() => expect(screen.getByRole('region', { name: '当前订阅' })).toBeTruthy());
  expect(screen.getByText('3 / 10 人')).toBeTruthy();
  expect(screen.getByText('项目不限数量')).toBeTruthy();
  expect(screen.getByText('VP202610130001')).toBeTruthy();
  expect(screen.getByRole('button', { name: '续费一年' })).toBeTruthy();
});

it('keeps purchase controls hidden for non-owners', async () => {
  mockFetch({ ...summary, role: 'member', policy: { ...summary.policy, canManageBilling: false } });
  render(<BillingPage organizationId="org-1" organizationName="研发组织" />);
  await waitFor(() => expect(screen.getByRole('region', { name: '当前订阅' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: '续费一年' })).toBeNull();
  expect(screen.getByText('只有组织所有者可以管理订阅与账单。')).toBeTruthy();
});

it('explains grace and read-only subscription states', async () => {
  mockFetch({ ...summary, subscription: { ...summary.subscription, status: 'expired' }, policy: { ...summary.policy, canWriteOrganization: false, denialReason: '订阅已过宽限期，请续费后继续编辑。' } });
  render(<BillingPage organizationId="org-1" organizationName="研发组织" />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('订阅已过宽限期，请续费后继续编辑。'));
});

it('shows billing load failure through the global message center', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: '账单服务暂时不可用。' } }) }));
  const messages: Array<{ text: string; tone: string }> = [];
  const onMessage = (event: Event) => messages.push((event as CustomEvent<{ text: string; tone: string }>).detail);
  window.addEventListener(messageEvent, onMessage);
  render(<BillingPage organizationId="org-1" organizationName="研发组织" />);
  await waitFor(() => expect(messages).toContainEqual({ text: '账单服务暂时不可用。', tone: 'error' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  window.removeEventListener(messageEvent, onMessage);
});

it('creates a pending order and keeps checking its payment status', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => summary })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'order-2', orderNo: 'VP202610130002', status: 'pending', planCode: 'team_30', amountCents: 128000, provider: 'manual' }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<BillingPage organizationId="org-1" organizationName="研发组织" />);
  await waitFor(() => expect(screen.getByRole('button', { name: '升级至团队 30 人' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '升级至团队 30 人' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/organizations\/org-1\/billing\/orders$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ planCode: 'team_30' }) })));
  expect(screen.getByText('正在等待支付宝确认付款')).toBeTruthy();
});

it('offers a contact path instead of public checkout for custom enterprise', async () => {
  const messages: string[] = [];
  const onMessage = (event: Event) => messages.push((event as CustomEvent<{ text: string }>).detail.text);
  window.addEventListener(messageEvent, onMessage);
  mockFetch();
  render(<BillingPage organizationId="org-1" organizationName="研发组织" />);
  await waitFor(() => expect(screen.getByRole('button', { name: '联系开通定制企业' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '联系开通定制企业' }));
  expect(messages).toContain('请联系 VibePlan 获取定制企业套餐。');
  window.removeEventListener(messageEvent, onMessage);
});
