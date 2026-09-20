import { ApiClient } from '../api-client.js';
import { saveSession } from '../auth.js';

export async function login(server: string): Promise<void> {
  const client = new ApiClient(server);
  const device = await client.startDevice();
  console.log(`Open the Vibe Plan web app and approve device code ${device.userCode}.`);
  const deadline = Date.now() + device.expiresInSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const session = await client.exchangeDevice(device.deviceCode);
      await saveSession({ server, ...session });
      console.log('Logged in successfully.');
      return;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('pending')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Device authorization expired.');
}
