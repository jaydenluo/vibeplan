// This unverified claim is only a local guard against replaying a queued
// operation under another account. The API still authenticates every request.
export function sessionActorId(session: { accessToken: string; actorId?: string }): string | undefined {
  if (session.actorId) return session.actorId;
  try {
    const payload = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined;
  } catch { return undefined; }
}
