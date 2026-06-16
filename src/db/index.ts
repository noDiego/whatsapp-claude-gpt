import { ensureTablesExist } from "./init";
import { drizzle } from 'drizzle-orm/better-sqlite3';
import sqlite, { Database } from 'better-sqlite3';
import * as schema from './schema';
import logger from '../logger';

try {
    ensureTablesExist();
} catch (error: any) {
    logger.error(`Database initialization failed: ${error.message}`);
    process.exit(1);
}

const sqliteDB = new sqlite('roboto.sqlite');

// Performance and reliability PRAGMAs
sqliteDB.pragma('journal_mode = WAL');
sqliteDB.pragma('busy_timeout = 5000');
sqliteDB.pragma('foreign_keys = ON');

logger.info(`SQLite journal_mode: ${sqliteDB.pragma('journal_mode', { simple: true })}`);

export const db = drizzle({ client: sqliteDB, schema });