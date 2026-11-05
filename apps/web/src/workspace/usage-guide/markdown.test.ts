import { expect, it } from 'vitest';
import { guideUrl } from './markdown.js';

it('keeps guide images under the deployment base and bundles existing repository document links', () => {
  expect(guideUrl('/guide/images/workflow.svg', 'src', '/vibe/')).toBe('/vibe/guide/images/workflow.svg');
  expect(guideUrl('guide/images/a.png', 'src', '/vibe/')).toBe('/vibe/guide/images/a.png');
  for (const path of ['LICENSE', 'docs/task-execution.md', 'docs/billing.md', 'docs/admin-console.md']) {
    expect(guideUrl(path, 'href')).not.toBe(path);
    expect(guideUrl(path, 'href')).not.toMatch(/^(data:|javascript:)/);
  }
  expect(guideUrl('./README.md', 'href')).toBe('https://github.com/jaydenluo/vibeplan/blob/main/README.md');
});

it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,bad', '//untrusted.test/a', '\\untrusted.test/a', 'file:///tmp/private'])('rejects unsafe URL %s', url => {
  expect(guideUrl(url, 'href')).toBe('');
  expect(guideUrl(url, 'src')).toBe('');
});
