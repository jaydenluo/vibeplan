import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { ApiClient, normalizeServer } from '../api-client.js';
import { saveSession } from '../auth.js';

export function webAppUrl(server: string): string {
  const url = new URL(server);
  const isLocalApi = (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') && url.port === '4000';
  if (isLocalApi) return 'http://localhost:5173';
  if (url.pathname === '/api' || url.pathname === '/api/') url.pathname = '/';
  return url.toString().replace(/\/$/, '');
}

export function loginPrompt(server: string, userCode: string): string {
  return `请打开 Vibe Plan 网页完成登录并批准设备码：\n登录页面：${webAppUrl(server)}\n设备码：${userCode}\n按回车自动打开登录页面，也可以复制网址手动打开。`;
}

export function openLoginPage(url: string): boolean {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function waitToOpenLoginPage(url: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    console.log('当前终端不支持自动打开浏览器，请复制上方登录页面地址访问。');
    return;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    await prompt.question('按回车打开登录页面：');
  } finally {
    prompt.close();
  }
  if (!openLoginPage(url)) console.log('无法自动打开浏览器，请复制上方登录页面地址访问。');
}

export async function login(server: string): Promise<void> {
  const normalizedServer = normalizeServer(server);
  const client = new ApiClient(normalizedServer);
  const device = await client.startDevice();
  console.log(loginPrompt(normalizedServer, device.userCode));
  await waitToOpenLoginPage(webAppUrl(normalizedServer));
  const deadline = Date.now() + device.expiresInSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const session = await client.exchangeDevice(device.deviceCode);
      await saveSession({ server: normalizedServer, ...session });
      console.log('Logged in successfully.');
      return;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('pending')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Device authorization expired.');
}
