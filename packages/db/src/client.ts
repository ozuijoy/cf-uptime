import { drizzle } from 'drizzle-orm/d1';
export { eq, and, or, desc, asc, sql } from 'drizzle-orm';

import * as schema from './schema';

export type Db = ReturnType<typeof getDb>;

export function getDb(env: { DB: D1Database }) {
  return drizzle(env.DB, { schema });
}
