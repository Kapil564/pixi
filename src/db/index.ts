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

export function retryMigration(): boolean {
  try {
    dbStatus = { status: 'migrating', errorText: null };
    migrate(db, { migrationsFolder: paths.migrationsFolder });
    dbStatus = { status: 'ready', errorText: null };
    console.log('[DB] Retry migration succeeded.');
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    dbStatus = { status: 'error', errorText: errMsg };
    console.error('[DB] Retry migration failed:', errMsg);
    return false;
  }
}

function runInitialMigration(attempt = 1, maxAttempts = 3): void {
  try {
    migrate(db, { migrationsFolder: paths.migrationsFolder });
    dbStatus = { status: 'ready', errorText: null };
    console.log('[DB] Auto-migration check completed successfully.');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (attempt < maxAttempts) {
      console.warn(`[DB] Migration attempt ${attempt}/${maxAttempts} failed: ${errMsg}. Retrying in 1s...`);
      setTimeout(() => runInitialMigration(attempt + 1, maxAttempts), 1000);
    } else {
      dbStatus = { status: 'error', errorText: errMsg };
      console.error(`[DB] Auto-migration failed after ${maxAttempts} attempts:`, errMsg);
    }
  }
}

runInitialMigration();
