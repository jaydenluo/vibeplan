import { describe, expect, it } from 'vitest';
import { rewriteProxiedSessionCookies } from './devProxyCookies.js';

describe('development API proxy session cookies', () => {
  it('removes Secure so localhost can persist proxied HTTPS session cookies', () => {
    const cookies = rewriteProxiedSessionCookies([
      'vibe_access=access-token; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Lax',
      'vibe_refresh=refresh-token; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);

    expect(cookies).toEqual([
      'vibe_access=access-token; Max-Age=1800; Path=/; HttpOnly; SameSite=Lax',
      'vibe_refresh=refresh-token; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax',
    ]);
  });
});
