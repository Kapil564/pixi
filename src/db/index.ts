import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getAppPaths, ensureUserDataDirectories } from '../shared/paths';
import * as schema from './schema';

export interface DatabaseStatus {
  status: 'ready' | 'migrating' | 'error';
  errorText?: string | null;
}

ensureUserDataDirectories();

const paths = getAppPaths();
console.log(`[DB] Connecting to per-user SQLite database at: ${paths.dbPath}`);

export const sqlite = new Database(paths.dbPath);
export const db = drizzle(sqlite, { schema });

let dbStatus: DatabaseStatus = { status: 'migrating', errorText: null };

export function getDatabaseStatus(): DatabaseStatus {
  return dbStatus;
}

export function assertDbReady(): void {
  if (dbStatus.status !== 'ready') {
    throw new Error(`Database operation blocked: SQLite database is not ready (${dbStatus.status}). ${dbStatus.errorText || ''}`);
  }
}

try {
  migrate(db, { migrationsFolder: paths.migrationsFolder });
  dbStatus = { status: 'ready', errorText: null };
  console.log('[DB] Auto-migration check completed successfully.');
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  dbStatus = { status: 'error', errorText: errMsg };
  console.error('[DB] Auto-migration error on database init:', errMsg);
}
