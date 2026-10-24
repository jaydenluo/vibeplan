/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useProjectEvents } from './useProjectEvents.js';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('refetches on every open, shows reconnection and compensates missed events', () => {
  vi.useFakeTimers();
  const close = vi.fn();
  let source: { onopen?: () => void; onerror?: () => void } = {};
  vi.stubGlobal('EventSource', class { onopen?: () => void; onerror?: () => void; close = close; addEventListener = vi.fn(); constructor() { source = this; } });
  const onChange = vi.fn();
  const hook = renderHook(() => useProjectEvents('project', onChange));
  act(() => source.onopen?.());
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(hook.result.current).toBe('connected');
  act(() => source.onerror?.());
  expect(hook.result.current).toBe('reconnecting');
  act(() => source.onopen?.());
  expect(onChange).toHaveBeenCalledTimes(2);
  act(() => vi.advanceTimersByTime(60_000));
  expect(onChange).toHaveBeenCalledTimes(3);
  hook.unmount();
  expect(close).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(60_000));
  expect(onChange).toHaveBeenCalledTimes(3);
});
