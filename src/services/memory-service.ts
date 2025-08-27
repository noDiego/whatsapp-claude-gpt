import { db } from '../db';
import { groupMemoriesTable, userMemoriesTable } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import logger from '../logger';
import { OperationResult } from '../interfaces/ai-interfaces';
import { CONFIG } from "../config";
import WspWeb from "../bot/wsp-web";

interface MemoryData {
    real_name?: string;
    nicknames?: string[];
    age?: number;
    profession?: string;
    location?: string;
    interests?: string[];
    likes?: string[];
    dislikes?: string[];
    relationships?: Record<string, any>;
    running_jokes?: string[];
    notes?: string[];
    jargon?: Record<string, any>;

    group_interests?: string[];
    recurring_topics?: string[];
    group_likes?: string[];
    group_dislikes?: string[];
    group_jargon?: string[];
    group_running_jokes?: string[];
    group_notes?: string[];
}


class MemoryServiceClass {

    // GET: Retrieve memory
    public async getMemory(chatId: string, authorId?: string): Promise<MemoryData | null> {
        try {
            if (!chatId) return null;
            const chat = await WspWeb.getWspClient().getChatById(chatId);

            if(chat.isGroup && !authorId){
                const result = await db.select()
                    .from(groupMemoriesTable)
                    .where(eq(groupMemoriesTable.chatId, chatId))
                    .get();

                return result ? this.mapGroupRowToSimpleData(result) : null;
            } else {
                const result = await db.select()
                    .from(userMemoriesTable)
                    .where(and(
                        eq(userMemoriesTable.chatId, chatId),
                        eq(userMemoriesTable.authorId, authorId)
                    ))
                    .get();
                return result ? this.mapUserRowToSimpleData(result) : null;
            }

        } catch (error) {
            logger.error(`Error getting memory: ${error.message}`);
            return null;
        }
    }

    // SAVE: Store/update memory (replaces completely)
    public async saveMemory(chatId: string, memoryData: MemoryData, authorId?: string): Promise<boolean> {
        try {
            const chat = await WspWeb.getWspClient().getChatById(chatId);
            const now = new Date().toISOString();

            if (chat.isGroup && !authorId) {
                // Group memory
                const existing = await db.select()
                    .from(groupMemoriesTable)
                    .where(eq(groupMemoriesTable.chatId, chatId))
                    .get();

                const groupData = {
                    chatId,
                    groupInterests: this.arrayToJson(memoryData.group_interests),
                    recurringTopics: this.arrayToJson(memoryData.recurring_topics),
                    groupLikes: this.arrayToJson(memoryData.group_likes),
                    groupDislikes: this.arrayToJson(memoryData.group_dislikes),
                    groupJargon: this.arrayToJson(memoryData.group_jargon),
                    groupRunningJokes: this.arrayToJson(memoryData.group_running_jokes),
                    groupNotes: this.arrayToJson(memoryData.group_notes),
                    updatedAt: now
                };

                if (existing) {
                    await db.update(groupMemoriesTable)
                        .set(groupData)
                        .where(eq(groupMemoriesTable.chatId, chatId))
                        .run();
                } else {
                    await db.insert(groupMemoriesTable).values({
                        id: uuidv4(),
                        ...groupData,
                        createdAt: now
                    }).run();
                }

            } else {
                if (!authorId) return false;

                const existing = await db.select()
                    .from(userMemoriesTable)
                    .where(and(
                        eq(userMemoriesTable.chatId, chatId),
                        eq(userMemoriesTable.authorId, authorId)
                    ))
                    .get();

                const userData = {
                    chatId,
                    authorId: authorId,
                    realName: memoryData.real_name || null,
                    nicknames: this.arrayToJson(memoryData.nicknames),
                    age: memoryData.age || null,
                    profession: memoryData.profession || null,
                    location: memoryData.location || null,
                    interests: this.arrayToJson(memoryData.interests),
                    likes: this.arrayToJson(memoryData.likes),
                    dislikes: this.arrayToJson(memoryData.dislikes),
                    relationships: memoryData.relationships ? JSON.stringify(memoryData.relationships) : null,
                    runningJokes: this.arrayToJson(memoryData.running_jokes),
                    personalNotes: this.arrayToJson(memoryData.notes),
                    updatedAt: now
                };

                if (existing) {
                    await db.update(userMemoriesTable)
                        .set(userData)
                        .where(and(
                            eq(userMemoriesTable.chatId, chatId),
                            eq(userMemoriesTable.authorId, authorId)
                        ))
                        .run();
                } else {
                    await db.insert(userMemoriesTable).values({
                        id: uuidv4(),
                        ...userData,
                        createdAt: now
                    }).run();
                }
            }

            logger.info(`Memory saved for ${chat.isGroup ? 'group' : 'user'}: ${chatId}`);
            return true;

        } catch (error) {
            logger.error(`Error saving memory: ${error.message}`);
            return false;
        }
    }

    // CLEAR: Delete memory
    public async clearMemory(chatId: string, authorId?: string): Promise<boolean> {
        try {
            const chat = await WspWeb.getWspClient().getChatById(chatId);

            if (chat.isGroup && !authorId) {
                const result = await db.delete(groupMemoriesTable)
                    .where(eq(groupMemoriesTable.chatId, chatId))
                    .run();
                return result.changes > 0;
            } else {
                if (!authorId) return false;

                const result = await db.delete(userMemoriesTable)
                    .where(and(
                        eq(userMemoriesTable.chatId, chatId),
                        eq(userMemoriesTable.authorId, authorId)
                    ))
                    .run();
                return result.changes > 0;
            }
        } catch (error) {
            logger.error(`Error clearing memory: ${error.message}`);
            return false;
        }
    }

    // Main function call processor
    public async processFunctionCall(args: any): Promise<OperationResult> {
        try {
            const {action, chat_id, author_id, memory_data} = args;

            let result: any;
            let message: string;

            switch (action) {
                case 'get':
                    result = await this.getMemory(chat_id, author_id);
                    message = result ? 'Memory retrieved successfully' : 'No memory found';
                    break;

                case 'save':
                    if (!memory_data) {
                        return {success: false, result: 'memory_data is required for save action'};
                    }

                    const saved = await this.saveMemory(chat_id, memory_data, author_id);
                    result = saved ? await this.getMemory(chat_id, author_id) : null;
                    message = saved ? 'Memory saved successfully' : 'Failed to save memory';
                    break;

                case 'clear':
                    const cleared = await this.clearMemory(chat_id, author_id);
                    result = null;
                    message = cleared ? 'Memory cleared successfully' : 'No memory found to clear';
                    break;

                default:
                    return {success: false, result: `Unknown action: ${action}`};
            }

            return {
                success: true,
                result: {
                    action,
                    message,
                    data: result
                }
            };

        } catch (error) {
            logger.error(`Error processing memory function call: ${error.message}`);
            return {
                success: false,
                result: `Error: ${error.message}`
            };
        }
    }

    // Format memory for system prompt
    public async getMemoryContext(chatId: string, authorId?: string): Promise<string> {
        try {
            const chat = await WspWeb.getWspClient().getChatById(chatId);

            const memory = await this.getMemory(chatId, authorId);
            if (!memory) return '';

            return (chat.isGroup ? `**GROUP MEMORY:**\n` : `**USER MEMORY:**\n`) + JSON.stringify(memory);

        } catch (error) {
            logger.error(`Error formatting memory context: ${error.message}`);
            return '';
        }
    }

    // Helper methods
    private arrayToJson(arr?: string[]): string | null {
        return arr && arr.length > 0 ? JSON.stringify(arr) : null;
    }

    private jsonToArray(json: string | null): string[] {
        if (!json) return [];
        try {
            const parsed = JSON.parse(json);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private mapUserRowToSimpleData(row: any): MemoryData {
        return {
            real_name: row.realName,
            nicknames: this.jsonToArray(row.nicknames),
            age: row.age,
            profession: row.profession,
            location: row.location,
            interests: this.jsonToArray(row.interests),
            likes: this.jsonToArray(row.likes),
            dislikes: this.jsonToArray(row.dislikes),
            relationships: row.relationships ? JSON.parse(row.relationships) : {},
            running_jokes: this.jsonToArray(row.runningJokes),
            jargon: row.jargon ? JSON.parse(row.jargon) : {},
            notes: this.jsonToArray(row.personalNotes)
        };
    }

    private mapGroupRowToSimpleData(row: any): MemoryData {
        return {
            group_interests: this.jsonToArray(row.groupInterests),
            recurring_topics: this.jsonToArray(row.recurringTopics),
            group_likes: this.jsonToArray(row.recurringTopics),
            group_dislikes: this.jsonToArray(row.recurringTopics),
            group_jargon: row.relationships ? JSON.parse(row.groupJargon) : {},
            group_running_jokes: this.jsonToArray(row.groupRunningJokes),
            group_notes: this.jsonToArray(row.groupNotes)
        };
    }
}

const MemoryService = new MemoryServiceClass();
export default MemoryService;