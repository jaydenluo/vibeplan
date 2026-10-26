/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BillingSummary } from '../api/client.js';
import { messageEvent } from '../api/client.js';
import { BillingPage } from './BillingPage.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('recovers an unpaid Alipay order after returning to the billing page and resumes checkout', async () => {
  const pending = { id: 'alipay-order', orderNo: 'VP-ALIPAY', planCode: 'personal' as const, amountCents: 12800, status: 'pending' as const, provider: 'alipay' };
  const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...summary, orders: [pending], payment: { provider: 'alipay', available: true, testMode: false } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...pending, payment: { provider: 'alipay', formAction: 'https://openapi.alipay.com/gateway.do', formFields: { app_id: 'app', sign: 'signature' } } }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<BillingPage organizationId="org-1" organizationName="研发组织" />);
  fireEvent.click(await screen.findByRole('button', { name: '继续支付' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/billing\/orders\/alipay-order\/pay$/), expect.objectContaining({ method: 'POST' })));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: '确认测试付款' })).toBeNull();
});

it('keeps billing readable and disables checkout while production credentials are missing', async () => {
  mockFetch({ ...summary, payment: { provider: 'unavailable', available: false, testMode: false } });
  render(<BillingPage organizationId="org-1" organizationName="研发组织" />);
  const checkout = await screen.findByRole('button', { name: '续费一年' });
  expect((checkout as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('在线支付暂未开通，请联系管理员。')).toBeTruthy();
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

it('offers the personal plan for 128 yuan per year and submits its plan code', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...summary, subscription: { planCode: 'free', status: 'free' }, orders: [] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'personal-order', status: 'pending', planCode: 'personal', amountCents: 12800, provider: 'manual' }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<BillingPage organizationId="org-1" organizationName="个人组织" />);
  const upgrade = await screen.findByRole('button', { name: '升级至个人版' });
  const card = upgrade.closest('article')!;
  expect(within(card).getByText('¥128/年')).toBeTruthy();
  expect(within(card).getByText('最多 1 名组织成员')).toBeTruthy();
  expect(within(card).getByText('个人使用，项目数量不限。')).toBeTruthy();
  fireEvent.click(upgrade);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/billing\/orders$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ planCode: 'personal' }) })));
});

it('allows personal subscribers to renew annually while keeping the free plan automatic', async () => {
  mockFetch({ ...summary, subscription: { ...summary.subscription, planCode: 'personal' }, policy: { ...summary.policy, memberUsage: 1, memberLimit: 1 } });
  render(<BillingPage organizationId="org-1" organizationName="个人组织" />);
  const renewal = await screen.findByRole('button', { name: '续费一年' });
  expect(within(renewal.closest('article')!).getByRole('heading', { name: '个人版' })).toBeTruthy();
  expect(screen.getByText('项目不限数量')).toBeTruthy();
  expect(screen.getByText('自动生效，无需续费')).toBeTruthy();
});

it('automatically includes the lifetime free plan without a renewal checkout', async () => {
  mockFetch({ ...summary, subscription: { planCode: 'free', status: 'free' }, policy: { ...summary.policy, memberUsage: 1, memberLimit: 1, projectUsage: 11, projectLimit: 50 }, orders: [] });
  render(<BillingPage organizationId="org-1" organizationName="个人组织" />);
  await screen.findByRole('region', { name: '当前订阅' });
  expect(screen.getByText('11 / 50 个')).toBeTruthy();
  const freePlan = screen.getByRole('heading', { name: '个人免费' }).closest('article')!;
  expect(within(freePlan).getByText('自动生效，无需续费')).toBeTruthy();
  expect(within(freePlan).getByText('长期免费')).toBeTruthy();
  expect(within(freePlan).queryByRole('button')).toBeNull();
  expect(screen.queryByRole('button', { name: '续费一年' })).toBeNull();
  expect(screen.getByText('个人使用，免费组织合计最多 50 个项目。')).toBeTruthy();
});

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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Billing service is temporarily unavailable.' } }) }));
  const messages: Array<{ text: string; tone: string }> = [];
  const onMessage = (event: Event) => messages.push((event as CustomEvent<{ text: string; tone: string }>).detail);
  window.addEventListener(messageEvent, onMessage);
  render(<BillingPage organizationId="org-1" organizationName="研发组织" />);
  await waitFor(() => expect(messages).toContainEqual({ text: '服务暂时不可用，请稍后重试。', tone: 'error' }));
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
  expect(screen.getByText('测试支付订单')).toBeTruthy();
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
