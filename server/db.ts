import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The migrations folder sits beside both server/ (in development) and dist/ (once built). */
const migrationsFolder = path.resolve(here, '../drizzle');

export type Db = ReturnType<typeof openDb>['db'];

/** Open the database file, or an in-memory one for tests, and bring its tables up to date. */
export function openDb(file: string) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}

/**
 * Keep a dated copy of the database beside it, one per day, newest seven kept.
 * Old copies are removed only from the backups folder this function owns.
 */
export async function backup(sqlite: Database.Database, dataDir: string): Promise<void> {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  await sqlite.backup(path.join(dir, `budget-${day}.db`));
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^budget-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .slice(0, -7);
  for (const f of old) fs.rmSync(path.join(dir, f));
}
