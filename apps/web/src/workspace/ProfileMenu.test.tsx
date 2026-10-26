/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileMenu } from './ProfileMenu.js';

afterEach(cleanup);

it('opens billing for the current organization directly below the profile entry', () => {
  const onOpenBilling = vi.fn();
  render(<ProfileMenu user={{ id: 'user', email: 'user@example.com' }} organizations={[{ id: 'org', name: '组织', slug: 'org' }]} organizationId="org" onSelectOrganization={vi.fn()} onCreateOrganization={vi.fn()} onOpenBilling={onOpenBilling} />);
  fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
  const billing = screen.getByRole('menuitem', { name: '订阅与账单' });
  expect(screen.getByRole('menuitem', { name: '个人资料' }).nextElementSibling).toBe(billing);
  fireEvent.click(billing);
  expect(onOpenBilling).toHaveBeenCalledWith('org');
  expect(screen.queryByRole('menu')).toBeNull();
});

it('disables billing until an organization is selected', () => {
  render(<ProfileMenu user={{ id: 'user', email: 'user@example.com' }} organizations={[]} organizationId="" onSelectOrganization={vi.fn()} onCreateOrganization={vi.fn()} onOpenBilling={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
  expect((screen.getByRole('menuitem', { name: '订阅与账单' }) as HTMLButtonElement).disabled).toBe(true);
});
