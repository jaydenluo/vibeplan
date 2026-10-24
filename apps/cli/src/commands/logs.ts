import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EventEmitter } from 'node:events';

const recentBytes = 64 * 1024;

function logPath(root: string): string {
  return join(resolve(root), '.vibe', 'daemon.log');
}

function readRecent(root: string, lines: number): { text: string; size: number } {
  const path = logPath(root);
  if (!existsSync(path)) return { text: '', size: 0 };
  const descriptor = openSync(path, 'r');
  try {
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, recentBytes);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    const all = buffer.toString('utf8').split('\n');
    if (all.at(-1) === '') all.pop();
    if (size > length) all.shift();
    const tail = all.slice(-lines).join('\n');
    return { text: tail ? `${tail}\n` : '', size };
  } finally { closeSync(descriptor); }
}

export function readRecentDaemonLogs(root = process.cwd(), lines = 20): string {
  return readRecent(root, lines).text;
}

type FollowOptions = {
  signals?: Pick<EventEmitter, 'once' | 'off'>;
  intervalMs?: number;
  write?: (value: string) => void;
};

export function followDaemonLogs(root = process.cwd(), options: FollowOptions = {}): Promise<void> {
  const signals = options.signals ?? process;
  const write = options.write ?? ((value: string) => process.stdout.write(value));
  const initial = readRecent(root, 20);
  if (initial.text) write(initial.text);
  let offset = initial.size;

  return new Promise((resolvePromise) => {
    const timer = setInterval(() => {
      const path = logPath(root);
      if (!existsSync(path)) { offset = 0; return; }
      const descriptor = openSync(path, 'r');
      try {
        const size = fstatSync(descriptor).size;
        if (size < offset) offset = 0;
        while (offset < size) {
          const buffer = Buffer.alloc(Math.min(size - offset, 16 * 1024));
          const count = readSync(descriptor, buffer, 0, buffer.length, offset);
          if (count === 0) break;
          offset += count;
          write(buffer.subarray(0, count).toString('utf8'));
        }
      } finally { closeSync(descriptor); }
    }, options.intervalMs ?? 500);
    const detach = () => {
      clearInterval(timer);
      signals.off('SIGINT', detach);
      write('\n已退出日志查看，后台同步继续运行。\n');
      resolvePromise();
    };
    signals.once('SIGINT', detach);
  });
}
