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
  return `请打开 Vibe Plan 网页完成登录并批准设备码：\n${webAppUrl(server)}\n设备码：${userCode}`;
}

export async function login(server: string): Promise<void> {
  const normalizedServer = normalizeServer(server);
  const client = new ApiClient(normalizedServer);
  const device = await client.startDevice();
  console.log(loginPrompt(normalizedServer, device.userCode));
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
