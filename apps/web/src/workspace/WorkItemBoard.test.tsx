/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkItemBoard, type WorkItem } from './WorkItemBoard.js';

it('moves a task between stage columns through the drop callback', () => {
  const onMove = vi.fn();
  const item: WorkItem = { id: 'task-1', title: '拖动任务', type: 'feature', status: 'backlog', priority: 'P2', progress: 0, version: 1 };
  render(<WorkItemBoard items={[item]} onSelect={vi.fn()} onMove={onMove} />);

  const card = screen.getByRole('button', { name: /拖动任务/ });
  const target = screen.getByRole('region', { name: '进行中' });
  const dataTransfer = { effectAllowed: '', setData: vi.fn() };
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(target);
  fireEvent.drop(target);

  expect(onMove).toHaveBeenCalledWith(item, 'in_progress');
});
