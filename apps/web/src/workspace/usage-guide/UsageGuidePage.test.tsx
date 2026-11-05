/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UsageGuidePage } from '../UsageGuidePage.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

it('renders GFM and gives Chinese, repeated and inline-code headings matching unique outline links', () => {
  render(<UsageGuidePage markdown={'# 指南\n\n## 安装 `CLI`\n\n### 图片\n\n## 安装 CLI\n\n| 命令 | 用途 |\n| --- | --- |\n| start | 同步 |\n\n![操作示意](/guide/images/workflow.svg)\n\n[许可](LICENSE)'} />);
  const headings = screen.getAllByRole('heading', { level: 2 });
  expect(headings.map(h => h.id)).toEqual(['安装-cli', '安装-cli-1']);
  const outline = screen.getByRole('navigation', { name: '本页大纲' });
  expect(within(outline).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['#安装-cli', '#图片', '#安装-cli-1']);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByAltText('操作示意').getAttribute('src')).toBe('/guide/images/workflow.svg');
  expect(screen.getByRole('link', { name: '许可' }).getAttribute('href')).not.toBe('LICENSE');
});

it('highlights supported code, copies original text and gracefully renders unknown or unlabelled languages', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const { container } = render(<UsageGuidePage markdown={'## 示例\n\n```js\nconst answer = 42;\n```\n\n```unknownlang\n<plain>\n```\n\n```\nno language\n```'} />);
  expect(container.querySelector('.hljs-keyword')?.textContent).toBe('const');
  expect(screen.getByText('unknownlang')).toBeTruthy();
  expect(screen.getByText('<plain>')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: '复制代码' })[0]!);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('const answer = 42;\n'));
  expect(await screen.findByRole('button', { name: '已复制' })).toBeTruthy();
});

it('does not execute raw HTML or retain dangerous URLs', () => {
  const { container } = render(<UsageGuidePage markdown={'## 安全\n\n<script>alert(1)</script>\n\n[危险](javascript:alert%281%29)\n\n![危险图片](data:text/html,bad)\n\n[正常](https://example.com)'} />);
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('危险').getAttribute('href')).toBeFalsy();
  expect(container.querySelector('img[src^="data:"]')).toBeNull();
  expect(screen.getByRole('link', { name: '正常' }).getAttribute('rel')).toContain('noopener');
});

it('navigates hashes, tracks the article scroll and returns the article to the top', async () => {
  const scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = scrollTo;
  window.history.replaceState({}, '', '/guide#第二节');
  render(<UsageGuidePage markdown={'# 指南\n\n## 第一节\n\n文字\n\n## 第二节'} />);
  await waitFor(() => expect(scrollTo).toHaveBeenCalled());
  const article = screen.getByRole('article');
  const outline = within(screen.getByRole('navigation', { name: '本页大纲' }));
  const first = outline.getByRole('link', { name: '第一节' });
  fireEvent.click(first);
  expect(decodeURIComponent(window.location.hash)).toBe('#第一节');
  expect(first.getAttribute('aria-current')).toBe('location');
  for (const heading of screen.getAllByRole('heading', { level: 2 })) {
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ top: heading.id === '第一节' ? -300 : 30 } as DOMRect);
  }
  fireEvent.scroll(article);
  await waitFor(() => expect(outline.getByRole('link', { name: '第二节' }).getAttribute('aria-current')).toBe('location'));
  fireEvent.click(screen.getByRole('link', { name: '返回顶部 ↑' }));
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 });
  expect(window.location.hash).toBe('');
  expect(screen.getByText('目录').closest('details')).toBeTruthy();
});

it('explains clipboard failures and leaves code available for manual selection', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  render(<UsageGuidePage markdown={'```bash\nvibeplan start\n```'} />);
  fireEvent.click(screen.getByRole('button', { name: '复制代码' }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', '复制失败，请选中代码手动复制。');
});

it('avoids suffix collisions and shows meaningful image failure text', () => {
  render(<UsageGuidePage markdown={'# 文档\n\n## A\n\n## A\n\n## A-1\n\n![安装示意](/guide/images/missing.png)'} />);
  expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.id)).toEqual(['a', 'a-1', 'a-1-1']);
  fireEvent.error(screen.getByAltText('安装示意'));
  expect(screen.getByText('图片暂时无法显示：安装示意')).toBeTruthy();
});

it('closes the mobile outline after choosing a chapter and follows later hash changes', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  render(<UsageGuidePage markdown={'## 安装\n\n## 验收'} />);
  const details = screen.getByText('目录').closest('details')!;
  details.open = true;
  fireEvent.click(within(screen.getByRole('navigation', { name: '移动端章节导航' })).getByRole('link', { name: '验收' }));
  expect(details.open).toBe(false);
  window.history.replaceState({}, '', '/guide#安装');
  fireEvent(window, new HashChangeEvent('hashchange'));
  await waitFor(() => expect(within(screen.getByRole('navigation', { name: '本页大纲' })).getByRole('link', { name: '安装' }).getAttribute('aria-current')).toBe('location'));
});
