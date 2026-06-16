import { db } from '../db';
import { groupMemoriesTable, userMemoriesTable } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import logger from '../logger';
import { OperationResult, ToolExecutionContext } from '../interfaces/ai-interfaces';
import { CONFIG } from "../config";
import WspWeb from "../bot/wsp-web";
import { safeJsonToObject, sanitizeForLog } from "../utils";

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
    group_jargon?: Record<string, any>;
    group_running_jokes?: string[];
    group_notes?: string[];
}


class MemoryServiceClass {

    // GET: Retrieve memory
    public async getMemory(chatId: string, authorId?: string, isGroup?: boolean): Promise<MemoryData | null> {
        try {
            if (!chatId) return null;
            if (isGroup === undefined) {
                const chat = await WspWeb.getWspClient().getChatById(chatId);
                isGroup = chat.isGroup;
            }

            if(isGroup && !authorId){
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
            logger.error(`Error getting memory: ${JSON.stringify(sanitizeForLog(error))}`);
            return null;
        }
    }

    // SAVE: Store/update memory (replaces completely)
    public async saveMemory(chatId: string, memoryData: MemoryData, authorId?: string, isGroup?: boolean): Promise<boolean> {
        try {
            if (isGroup === undefined) {
                const chat = await WspWeb.getWspClient().getChatById(chatId);
                isGroup = chat.isGroup;
            }
            const now = new Date().toISOString();

            if (isGroup && !authorId) {
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
                    groupJargon: memoryData.group_jargon ? JSON.stringify(memoryData.group_jargon) : null,
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

            logger.info(`Memory saved for ${isGroup ? 'group' : 'user'}: ${chatId}`);
            return true;

        } catch (error) {
            logger.error(`Error saving memory: ${JSON.stringify(sanitizeForLog(error))}`);
            return false;
        }
    }

    // CLEAR: Delete memory
    public async clearMemory(chatId: string, authorId?: string, isGroup?: boolean): Promise<boolean> {
        try {
            if (isGroup === undefined) {
                const chat = await WspWeb.getWspClient().getChatById(chatId);
                isGroup = chat.isGroup;
            }

            if (isGroup && !authorId) {
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
            logger.error(`Error clearing memory: ${JSON.stringify(sanitizeForLog(error))}`);
            return false;
        }
    }

    // Main function call processor
    public async processFunctionCall(args: any, context?: ToolExecutionContext): Promise<OperationResult> {
        try {
            const {action, chat_id, author_id, memory_data} = args;
            const isGroup = context?.isGroup;

            let result: any;
            let message: string;

            switch (action) {
                case 'get':
                    result = await this.getMemory(chat_id, author_id, isGroup);
                    message = result ? 'Memory retrieved successfully' : 'No memory found';
                    break;

                case 'save':
                    if (!memory_data) {
                        return {success: false, result: 'memory_data is required for save action'};
                    }

                    const saved = await this.saveMemory(chat_id, memory_data, author_id, isGroup);
                    result = saved ? await this.getMemory(chat_id, author_id, isGroup) : null;
                    message = saved ? 'Memory saved successfully' : 'Failed to save memory';
                    break;

                case 'clear':
                    const cleared = await this.clearMemory(chat_id, author_id, isGroup);
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
            logger.error(`Error processing memory function call: ${JSON.stringify(sanitizeForLog(error))}`);
            return {
                success: false,
                result: `Error: ${error.message}`
            };
        }
    }

    // Format memory for system prompt
    public async getMemoryContext(chatId: string, authorId?: string, isGroup?: boolean): Promise<string> {
        try {
            // Resolve isGroup from WhatsApp only if not provided by the caller.
            // This prevents losing all memory when WhatsApp can't resolve the chat
            // but the caller already knows the group/private context.
            if (isGroup === undefined) {
                try {
                    const chat = await WspWeb.getWspClient().getChatById(chatId);
                    isGroup = chat.isGroup;
                } catch {
                    // Fall back: without isGroup, default to user memory prefix.
                    isGroup = false;
                }
            }

            const memory = await this.getMemory(chatId, authorId, isGroup);
            if (!memory) return '';

            return (isGroup ? `**GROUP MEMORY:**\n` : `**USER MEMORY:**\n`) + JSON.stringify(memory);

        } catch (error) {
            logger.error(`Error formatting memory context: ${JSON.stringify(sanitizeForLog(error))}`);
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
            relationships: safeJsonToObject(row.relationships),
            running_jokes: this.jsonToArray(row.runningJokes),
            jargon: safeJsonToObject(row.jargon),
            notes: this.jsonToArray(row.personalNotes)
        };
    }

    private mapGroupRowToSimpleData(row: any): MemoryData {
        return {
            group_interests: this.jsonToArray(row.groupInterests),
            recurring_topics: this.jsonToArray(row.recurringTopics),
            group_likes: this.jsonToArray(row.groupLikes),
            group_dislikes: this.jsonToArray(row.groupDislikes),
            group_jargon: safeJsonToObject(row.groupJargon),
            group_running_jokes: this.jsonToArray(row.groupRunningJokes),
            group_notes: this.jsonToArray(row.groupNotes)
        };
    }
}

const MemoryService = new MemoryServiceClass();
export default MemoryService;
