import sqlite from 'better-sqlite3';
import logger from '../logger';

/**
 * Migrates the user_memories table to relax the real_name NOT NULL constraint.
 * SQLite does not support ALTER COLUMN to remove NOT NULL, so we recreate the
 * table when the existing column still has the old constraint.
 *
 * The migration is idempotent: it only runs when real_name is still NOT NULL.
 * Fresh databases are created with the nullable column directly by the main
 * ensureTablesExist flow below.
 */
function migrateUserMemoriesRealName(db: sqlite.Database): void {
    const colInfo = db.prepare("PRAGMA table_info('user_memories')").all() as Array<{
        cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
    }>;
    const realNameCol = colInfo.find((c) => c.name === 'real_name');
    if (!realNameCol || realNameCol.notnull === 0) {
        // Already nullable or table does not exist yet
        return;
    }

    logger.info('Migrating user_memories.real_name from NOT NULL to nullable...');

    db.exec(`
        CREATE TABLE user_memories_new (
            id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            author_id TEXT NOT NULL,
            real_name TEXT,
            nicknames TEXT,
            age INTEGER,
            profession TEXT,
            location TEXT,
            interests TEXT,
            likes TEXT,
            dislikes TEXT,
            relationships TEXT,
            running_jokes TEXT,
            jargon TEXT,
            personal_notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(chat_id, author_id)
        );

        INSERT INTO user_memories_new
            SELECT * FROM user_memories;

        DROP TABLE user_memories;

        ALTER TABLE user_memories_new RENAME TO user_memories;
    `);

    logger.info('Migration of user_memories.real_name completed.');
}

export function ensureTablesExist(dbPath: string = 'roboto.sqlite') {
    let db: sqlite.Database | null = null;
    try {
        db = sqlite(dbPath);

        db.prepare(`
            CREATE TABLE IF NOT EXISTS reminders (
              id TEXT PRIMARY KEY,
              message TEXT NOT NULL,
              reminder_date TEXT NOT NULL,
              reminder_date_tz TEXT NOT NULL,
              chat_id TEXT NOT NULL,
              chat_name TEXT,
              is_active BOOLEAN NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              recurrence_type TEXT,
              recurrence_interval INTEGER,
              recurrence_end_date TEXT,
              recurrence_end_date_tz TEXT
            )
        `).run();

        db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_reminders_active_date
                ON reminders(is_active, reminder_date)
        `).run();

        db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_reminders_chat_id
                ON reminders(chat_id)
        `).run();

        db.prepare(`
            CREATE TABLE IF NOT EXISTS chat_configurations (
                chat_id TEXT PRIMARY KEY,
                name TEXT,
                prompt_info TEXT,
                bot_name TEXT,
                is_group BOOLEAN NOT NULL,
                max_msgs_limit INTEGER,
                max_hours_limit INTEGER
            )
        `).run();

        db.prepare(`
            CREATE TABLE IF NOT EXISTS user_memories (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                author_id TEXT NOT NULL,
                real_name TEXT,
                nicknames TEXT,
                age INTEGER,
                profession TEXT,
                location TEXT,
                interests TEXT,
                likes TEXT,
                dislikes TEXT,
                relationships TEXT,
                running_jokes TEXT,
                jargon TEXT,
                personal_notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(chat_id, author_id)
            )
        `).run();

        // Relax real_name constraint on databases created with the old schema
        migrateUserMemoriesRealName(db);

        db.prepare(`
            CREATE TABLE IF NOT EXISTS group_memories (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL UNIQUE,
                group_interests TEXT,
                recurring_topics TEXT,
                group_likes TEXT,
                group_dislikes TEXT,
                group_jargon TEXT,
                group_running_jokes TEXT,
                group_notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(chat_id)
            )
        `).run();

        logger.info('Database tables ensured.');
    } catch (error: any) {
        logger.error(`ensureTablesExist failed: ${error.message}`);
        throw error;
    } finally {
        if (db) {
            try { db.close(); } catch (_) { /* ignore close errors */ }
        }
    }
}