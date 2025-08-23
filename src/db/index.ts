import { ensureTablesExist } from "./init";

ensureTablesExist();

import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Database } from 'better-sqlite3';
import sqlite from 'better-sqlite3';
import * as schema from './schema';


const sqliteDB: Database = sqlite('roboto.sqlite');
export const db = drizzle(sqliteDB, { schema });

const a = new Date();
