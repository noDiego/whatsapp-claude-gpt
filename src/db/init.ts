import sqlite from 'better-sqlite3';
import logger from '../logger';

export function ensureTablesExist(dbPath: string = 'roboto.sqlite') {
    const db = sqlite(dbPath);

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
     real_name TEXT NOT NULL,
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


    db.close();
    logger.info('Database tables ensured.');
}