import { describe, expect, it } from 'vitest';
import { loginPrompt, webAppUrl } from './login.js';

describe('device login prompt', () => {
  it('shows a clickable official website URL and device code', () => {
    const prompt = loginPrompt('https://vibeplan.szxinjin.cn/api', '123456');
    expect(prompt).toContain('https://vibeplan.szxinjin.cn');
    expect(prompt).toContain('设备码：123456');
    expect(prompt).toContain('按回车');
    expect(prompt).toContain('登录页面');
  });

  it('uses the web app address for local and custom API servers', () => {
    expect(webAppUrl('http://localhost:4000')).toBe('http://localhost:5173');
    expect(webAppUrl('https://plan.example.com/api')).toBe('https://plan.example.com');
  });
});
