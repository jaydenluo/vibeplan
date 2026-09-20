const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export { apiBase };
