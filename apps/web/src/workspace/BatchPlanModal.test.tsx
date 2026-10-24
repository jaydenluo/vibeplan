/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { messageEvent } from '../api/client.js';
import { BatchPlanModal } from './BatchPlanModal.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const items = [
  { id: first, title: '实现登录', status: 'ready' },
  { id: second, title: '父任务', status: 'ready' },
  { id: '33333333-3333-4333-8333-333333333333', title: '已完成', status: 'done', parentId: second },
  { id: '44444444-4444-4444-8444-444444444444', title: '已取消', status: 'cancelled' },
  { id: '55555555-5555-4555-8555-555555555555', title: '待验收', status: 'in_review' },
];
function setup() { render(<BatchPlanModal projectName="测试项目" items={items} onClose={vi.fn()} />); }

it('selects unfinished leaves and requires an explicit real project check', () => {
  setup();
  expect(screen.getByLabelText('实现登录')).toBeTruthy();
  expect(screen.queryByLabelText('父任务')).toBeNull();
  expect(screen.queryByLabelText('已完成')).toBeNull();
  expect(screen.queryByLabelText('已取消')).toBeNull();
  expect(screen.queryByLabelText('待验收')).toBeNull();
  expect((screen.getByRole('button', { name: '复制准备命令' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('项目测试命令（JSON 参数数组）'), { target: { value: '["npm","test"]' } });
  expect(screen.getByLabelText('准备命令').textContent).toBe(`vibeplan plan:prepare --task ${first} --check '["npm","test"]'`);
  fireEvent.click(screen.getByLabelText('实现登录'));
  expect((screen.getByRole('button', { name: '复制准备命令' }) as HTMLButtonElement).disabled).toBe(true);
});

it('quotes shell metacharacters as literal check arguments and reports successful copy', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const messages: Array<{ text: string; tone: string }> = [];
  const onMessage = (event: Event) => messages.push((event as CustomEvent<{ text: string; tone: string }>).detail);
  window.addEventListener(messageEvent, onMessage);
  setup();
  fireEvent.change(screen.getByLabelText('项目测试命令（JSON 参数数组）'), { target: { value: JSON.stringify(['node', 'tests/it\'s $(touch bad).js']) } });
  fireEvent.click(screen.getByRole('button', { name: '复制准备命令' }));
  await waitFor(() => expect(messages).toContainEqual({ text: '准备命令已复制', tone: 'success' }));
  expect(writeText.mock.calls[0][0]).toContain(`'"'"'`);
  expect(writeText.mock.calls[0][0]).toContain('$(touch bad)');
  window.removeEventListener(messageEvent, onMessage);
});

it('rejects malformed checks and unsafe task IDs and exposes clipboard failures', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  const messages: Array<{ text: string; tone: string }> = [];
  const onMessage = (event: Event) => messages.push((event as CustomEvent<{ text: string; tone: string }>).detail);
  window.addEventListener(messageEvent, onMessage);
  setup();
  fireEvent.change(screen.getByLabelText('项目测试命令（JSON 参数数组）'), { target: { value: '["npm",null]' } });
  fireEvent.click(screen.getByRole('button', { name: '复制准备命令' }));
  expect(messages).toContainEqual({ text: '请输入由非空字符串组成的 JSON 参数数组。', tone: 'error' });
  fireEvent.change(screen.getByLabelText('项目测试命令（JSON 参数数组）'), { target: { value: '["npm","test"]' } });
  fireEvent.click(screen.getByRole('button', { name: '复制准备命令' }));
  await waitFor(() => expect(messages).toContainEqual({ text: '复制失败，请手动选择并复制下方命令。', tone: 'error' }));
  window.removeEventListener(messageEvent, onMessage);
  cleanup();
  render(<BatchPlanModal projectName="测试" items={[{ id: 'x; touch bad', title: '异常任务', status: 'ready' }]} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('项目测试命令（JSON 参数数组）'), { target: { value: '["npm","test"]' } });
  expect((screen.getByRole('button', { name: '复制准备命令' }) as HTMLButtonElement).disabled).toBe(true);
});

it('explains local manifest approval and restores focus when closed by Escape', () => {
  const onClose = vi.fn();
  render(<BatchPlanModal projectName="测试" items={[]} onClose={onClose} />);
  expect(screen.getByText(/浏览器不能在你的电脑上执行代码/)).toBeTruthy();
  expect(screen.getByText(/integrationChecks/)).toBeTruthy();
  expect(screen.getByText(/默认保留人工验收/)).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});
