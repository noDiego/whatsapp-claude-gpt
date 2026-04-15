import { ensureTablesExist } from "./init";
import { drizzle } from 'drizzle-orm/better-sqlite3';
import sqlite, { Database } from 'better-sqlite3';
import * as schema from './schema';

ensureTablesExist();


const sqliteDB = new sqlite('roboto.sqlite');

export const db = drizzle({ client: sqliteDB, schema });