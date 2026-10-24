export function rewriteProxiedSessionCookies(cookies: string[]): string[] {
  return cookies.map((cookie) => cookie.replace(/;\s*Secure\b/gi, ''));
}
