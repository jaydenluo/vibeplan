import { describe, expect, it } from 'vitest';
import { loginPrompt, webAppUrl } from './login.js';

describe('device login prompt', () => {
  it('shows a clickable official website URL and device code', () => {
    expect(loginPrompt('https://vibeplan.szxinjin.cn/api', '123456')).toContain('https://vibeplan.szxinjin.cn');
    expect(loginPrompt('https://vibeplan.szxinjin.cn/api', '123456')).toContain('设备码：123456');
  });

  it('uses the web app address for local and custom API servers', () => {
    expect(webAppUrl('http://localhost:4000')).toBe('http://localhost:5173');
    expect(webAppUrl('https://plan.example.com/api')).toBe('https://plan.example.com');
  });
});
