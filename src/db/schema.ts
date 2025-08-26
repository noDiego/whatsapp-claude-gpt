// src/db/schema.ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const remindersTable = sqliteTable('reminders', {
    id: text('id').primaryKey(),
    message: text('message').notNull(),

    reminderDate: text('reminder_date').notNull(),
    reminderDateTZ: text('reminder_date_tz').notNull(),

    chatId: text('chat_id').notNull(),
    chatName: text('chat_name'),

    isActive: integer('is_active', { mode: 'boolean' }).notNull(),

    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),

    recurrenceType: text('recurrence_type'), // none | minutes | daily | weekly | monthly
    recurrenceInterval: integer('recurrence_interval'),
    recurrenceEndDate: text('recurrence_end_date'),
    recurrenceEndDateTZ: text('recurrence_end_date_tz'),
});

export const chatConfigsTable = sqliteTable('chat_configurations', {
    chatId: text('chat_id').primaryKey(),
    name: text('name'),
    promptInfo: text('prompt_info'),
    botName: text('bot_name'),
    isGroup: integer('is_group', { mode: 'boolean' }).notNull(),
    maxMsgsLimit: integer('max_msgs_limit'),
    maxHoursLimit: integer('max_hours_limit'),
});

export const userMemoriesTable = sqliteTable('user_memories', {
    id: text('id').primaryKey(),
    chatId: text('chat_id').notNull(),
    authorId: text('author_id').notNull(),

    // Basic personal data
    realName: text('real_name'),
    age: integer('age'),
    profession: text('profession'),
    location: text('location'),

    // Interests and tastes
    interests: text('interests'), // JSON string with an array of interests
    likes: text('likes'), // JSON string with things they like
    dislikes: text('dislikes'), // JSON string with things they don't like

    // Relationship and family information
    relationships: text('relationships'), // JSON string with info about family, partner, etc.

    // Inside jokes and recurring references
    runningJokes: text('running_jokes'), // JSON string with recurring jokes
    nicknames: text('nicknames'), // JSON string with nicknames

    // General notes
    personalNotes: text('personal_notes'), // JSON string with array of notes

    jargon: text('jargon'), // JSON string with common terms/slang and their meanings

    // Metadata
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
});

// NUEVA TABLA: Memoria de grupos
export const groupMemoriesTable = sqliteTable('group_memories', {
    id: text('id').primaryKey(),
    chatId: text('chat_id').notNull().unique(),

    // Group preferences and characteristics
    groupInterests: text('group_interests'), // JSON string with group's common interests
    recurringTopics: text('recurring_topics'), // JSON string with topics often discussed
    groupLikes: text('group_likes'), // JSON string with things the group likes
    groupDislikes: text('group_dislikes'), // JSON string with things the group dislikes

    // Group-specific jargon and culture
    groupJargon: text('group_jargon'), // JSON string with group-specific terms and meanings
    groupRunningJokes: text('group_running_jokes'), // JSON string with group inside jokes

    // General group notes
    groupNotes: text('group_notes'), // JSON string with array of general notes about the group

    // Metadata
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
});