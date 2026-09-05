import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getAppPaths, ensureUserDataDirectories } from '../shared/paths';

ensureUserDataDirectories();

const paths = getAppPaths();
console.log(`[DB Migrate] Running migrations against: ${paths.dbPath}`);
const sqlite = new Database(paths.dbPath);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: paths.migrationsFolder });
console.log('Migration complete.');
sqlite.close();
