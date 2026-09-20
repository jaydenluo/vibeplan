import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

export const sqlClient = postgres(process.env.DATABASE_URL ?? 'postgres://vibe:vibe@localhost:5432/vibe_plan', {
  onnotice: () => undefined,
});
export const db = drizzle(sqlClient);
