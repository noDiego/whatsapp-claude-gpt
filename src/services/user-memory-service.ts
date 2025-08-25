import { db } from '../db';
import { groupMemories, userMemories } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import logger from '../logger';
import { OperationResult } from '../interfaces/ai-interfaces';
import { CONFIG } from "../config";
import WspWeb from "../bot/wsp-web";

export interface UserMemoryData {
    id?: string;
    chatId: string;
    authorId: string;
    authorName: string;
    isGroup: boolean;
    age?: number;
    profession?: string;
    location?: string;
    interests?: string[];
    likes?: string[];
    dislikes?: string[];
    relationships?: Record<string, any>;
    runningJokes?: string[];
    nicknames?: string[];
    personalNotes?: string[];
    jargon?: Record<string, string>;
    createdAt?: Date;
    updatedAt?: Date;
    lastInteractionAt?: Date;
}

export interface GroupMemoryData {
    id?: string;
    chatId: string;
    chatName: string;
    groupInterests?: string[];
    recurringTopics?: string[];
    groupLikes?: string[];
    groupDislikes?: string[];
    groupJargon?: Record<string, string>;
    groupRunningJokes?: string[];
    groupTraditions?: string[];
    groupNotes?: string[];
    createdAt?: Date;
    updatedAt?: Date;
    lastInteractionAt?: Date;
}

interface MemoryOperationResult {
    success: boolean;
    data?: any;
    message: string;
    operation?: string;
    scope?: string;
}

class MemoryServiceClass {
    private readonly MAX_ARRAY_SIZE = 50;
    private readonly MAX_OBJECT_SIZE = 100;
    private readonly MAX_STRING_LENGTH = 500;

    // Public API methods (mantener compatibilidad)
    public async getUserMemory(chatId: string, authorId: string): Promise<UserMemoryData | null> {
        try {
            const result = await db.select()
                .from(userMemories)
                .where(and(
                    eq(userMemories.chatId, chatId),
                    eq(userMemories.authorId, authorId)
                ))
                .get();

            return result ? this.mapRowToUserMemory(result) : null;
        } catch (error) {
            logger.error(`Error getting user memory: ${error.message}`);
            return null;
        }
    }

    public async getGroupMemory(chatId: string): Promise<GroupMemoryData | null> {
        try {
            const result = await db.select()
                .from(groupMemories)
                .where(eq(groupMemories.chatId, chatId))
                .get();

            return result ? this.mapRowToGroupMemory(result) : null;
        } catch (error) {
            logger.error(`Error getting group memory: ${error.message}`);
            return null;
        }
    }

    public async getChatMemories(chatId: string): Promise<UserMemoryData[]> {
        try {
            const results = await db.select()
                .from(userMemories)
                .where(eq(userMemories.chatId, chatId))
                .all();

            return results.map(this.mapRowToUserMemory);
        } catch (error) {
            logger.error(`Error getting chat memories: ${error.message}`);
            return [];
        }
    }

    public async getFormattedMemorias(chatId: string): Promise<string> {
        if (!CONFIG.BotConfig.memoriesEnabled) return null;

        const chat = await WspWeb.getWspClient().getChatById(chatId);
        let formattedMemories = '';

        if (chat.isGroup) {
            const groupMemory = await this.getGroupMemory(chatId);
            formattedMemories = this.formatMemoriesForPrompt([], groupMemory); // Only group information will be sent for group chats
        } else {
            const userMemories = await this.getChatMemories(chatId);
            formattedMemories = this.formatMemoriesForPrompt(userMemories); // Only user information will be sent for private chats
        }

        return formattedMemories;
    }

    // Nueva API unificada
    public async processFunctionCall(args: any): Promise<OperationResult> {
        try {
            const result = await this.processMemoryOperation(args);

            return {
                success: result.success,
                result: {
                    operation: result.operation,
                    scope: result.scope,
                    message: result.message,
                    data: result.data
                }
            };
        } catch (error) {
            logger.error(`Error processing memory function call: ${error.message}`);
            return {
                success: false,
                result: {
                    operation: 'error',
                    scope: args.scope || 'unknown',
                    message: `Error: ${error.message}`,
                    data: null
                }
            };
        }
    }

    private async processMemoryOperation(args: any): Promise<MemoryOperationResult> {
        const { scope, action, target, ops, source_msg_id } = args;

        if (!['user', 'group'].includes(scope)) {
            throw new Error(`Invalid scope: ${scope}`);
        }

        if (!['get', 'upsert', 'patch', 'delete'].includes(action)) {
            throw new Error(`Invalid action: ${action}`);
        }

        if (scope === 'user' && !target.author_id && action !== 'get') {
            throw new Error('author_id is required for user scope operations');
        }

        if (scope === 'group' && !target.chat_name && ['upsert', 'patch'].includes(action)) {
            throw new Error('chat_name is required for group upsert/patch operations');
        }

        if (scope === 'group') {
            const chat = await WspWeb.getWspClient().getChatById(target.chat_id);
            if (!chat.isGroup) {
                throw new Error('Group scope can only be used in group chats');
            }
        }

        if (source_msg_id && await this.isTranscribedMessage(source_msg_id)) {
            return {
                success: false,
                message: 'Cannot store transcribed content as personal memory',
                operation: action,
                scope
            };
        }

        if (scope === 'user') {
            return await this.processUserOperation(action, target, ops);
        } else {
            return await this.processGroupOperation(action, target, ops);
        }
    }

    private async processUserOperation(action: string, target: any, ops: any): Promise<MemoryOperationResult> {
        const { chat_id, author_id, author_name } = target;

        switch (action) {
            case 'get':
                if (author_id) {
                    const memory = await this.getUserMemory(chat_id, author_id);
                    if(!memory) return {success: true, message: 'No memory found for this user'};
                    const { lastInteractionAt, ...memoryFiltered } = memory
                    return {
                        success: true,
                        data: memoryFiltered,
                        message: 'User memory retrieved',
                        operation: 'get',
                        scope: 'user'
                    };
                } else {
                    const memories = await this.getChatMemories(chat_id);
                    const memoriesFiltered = memories.map(({ lastInteractionAt, ...rest }) => rest);
                    return {
                        success: true,
                        data: memoriesFiltered,
                        message: `Retrieved ${memories.length} user memories from chat`,
                        operation: 'get',
                        scope: 'user'
                    };
                }

            case 'delete':
                await db.delete(userMemories)
                    .where(and(
                        eq(userMemories.chatId, chat_id),
                        eq(userMemories.authorId, author_id)
                    ))
                    .run();
                return {
                    success: true,
                    message: `Memory deleted for user ${author_name || author_id}`,
                    operation: 'delete',
                    scope: 'user'
                };

            case 'upsert':
                return await this.upsertUserMemory(chat_id, author_id, author_name, ops);

            case 'patch':
                return await this.patchUserMemory(chat_id, author_id, ops);

            default:
                throw new Error(`Unsupported action: ${action}`);
        }
    }

    private async processGroupOperation(action: string, target: any, ops: any): Promise<MemoryOperationResult> {
        const { chat_id, chat_name } = target;

        switch (action) {
            case 'get':
                const memory = await this.getGroupMemory(chat_id);
                if(!memory) return {success: true, message: 'No memory found for this group'};
                const { lastInteractionAt, ...memoryFiltered } = memory;
                return {
                    success: true,
                    data: memoryFiltered,
                    message: memoryFiltered ? 'Group memory retrieved' : 'No group memory found',
                    operation: 'get',
                    scope: 'group'
                };

            case 'delete':
                await db.delete(groupMemories)
                    .where(eq(groupMemories.chatId, chat_id))
                    .run();
                return {
                    success: true,
                    message: `Group memory deleted for ${chat_name}`,
                    operation: 'delete',
                    scope: 'group'
                };

            case 'upsert':
                return await this.upsertGroupMemory(chat_id, chat_name, ops);

            case 'patch':
                return await this.patchGroupMemory(chat_id, ops);

            default:
                throw new Error(`Unsupported action: ${action}`);
        }
    }

    private async upsertUserMemory(chatId: string, authorId: string, authorName: string, ops: any): Promise<MemoryOperationResult> {
        const now = new Date();
        const existing = await this.getUserMemory(chatId, authorId);
        const chat = await WspWeb.getWspClient().getChatById(chatId);

        if (existing) {
            const updatedData = this.buildUserUpdateData(existing, ops);
            updatedData.authorName = authorName;
            updatedData.updatedAt = now;
            updatedData.lastInteractionAt = now;

            await db.update(userMemories)
                .set(this.serializeUserMemory(updatedData))
                .where(and(
                    eq(userMemories.chatId, chatId),
                    eq(userMemories.authorId, authorId)
                ))
                .run();

            const result = await this.getUserMemory(chatId, authorId);
            return {
                success: true,
                data: result,
                message: `User memory updated for ${authorName}`,
                operation: 'upsert',
                scope: 'user'
            };
        } else {
            const newMemory = this.buildUserUpdateData({
                chatId,
                authorId,
                authorName,
                isGroup: chat.isGroup
            } as UserMemoryData, ops);

            const nowIso = new Date().toISOString();

            const serialized = {
                id: uuidv4(),
                ...this.serializeUserMemory(newMemory),
                createdAt: nowIso,
                updatedAt: nowIso,
                lastInteractionAt: nowIso
            };


            await db.insert(userMemories).values(serialized).run();
            const result = await this.getUserMemory(chatId, authorId);

            return {
                success: true,
                data: result,
                message: `User memory created for ${authorName}`,
                operation: 'upsert',
                scope: 'user'
            };
        }
    }

    private async patchUserMemory(chatId: string, authorId: string, ops: any): Promise<MemoryOperationResult> {
        const existing = await this.getUserMemory(chatId, authorId);
        if (!existing) {
            return {
                success: false,
                message: 'Cannot patch non-existing user memory. Use upsert instead.',
                operation: 'patch',
                scope: 'user'
            };
        }

        const patched = this.applyPatchOperations(existing, ops, 'user');
        patched.updatedAt = new Date();
        patched.lastInteractionAt = new Date();

        await db.update(userMemories)
            .set(this.serializeUserMemory(patched))
            .where(and(
                eq(userMemories.chatId, chatId),
                eq(userMemories.authorId, authorId)
            ))
            .run();

        const result = await this.getUserMemory(chatId, authorId);
        return {
            success: true,
            data: result,
            message: `User memory patched for ${existing.authorName}`,
            operation: 'patch',
            scope: 'user'
        };
    }

    private async upsertGroupMemory(chatId: string, chatName: string, ops: any): Promise<MemoryOperationResult> {
        const now = new Date().toISOString();
        const existing = await this.getGroupMemory(chatId);

        if (existing) {
            const updatedData = this.buildGroupUpdateData(existing, ops);
            updatedData.chatName = chatName;
            updatedData.updatedAt = new Date();
            updatedData.lastInteractionAt = new Date();

            await db.update(groupMemories)
                .set(this.serializeGroupMemory(updatedData))
                .where(eq(groupMemories.chatId, chatId))
                .run();

            const result = await this.getGroupMemory(chatId);
            return {
                success: true,
                data: result,
                message: `Group memory updated for ${chatName}`,
                operation: 'upsert',
                scope: 'group'
            };
        } else {
            const newMemory = this.buildGroupUpdateData({
                chatId,
                chatName
            } as GroupMemoryData, ops);

            const nowIso = new Date().toISOString();

            const serialized = {
                id: uuidv4(),
                ...this.serializeGroupMemory(newMemory),
                createdAt: nowIso,
                updatedAt: nowIso,
                lastInteractionAt: nowIso
            };

            await db.insert(groupMemories).values(serialized).run();
            const result = await this.getGroupMemory(chatId);

            return {
                success: true,
                data: result,
                message: `Group memory created for ${chatName}`,
                operation: 'upsert',
                scope: 'group'
            };
        }
    }

    private async patchGroupMemory(chatId: string, ops: any): Promise<MemoryOperationResult> {
        const existing = await this.getGroupMemory(chatId);
        if (!existing) {
            return {
                success: false,
                message: 'Cannot patch non-existing group memory. Use upsert instead.',
                operation: 'patch',
                scope: 'group'
            };
        }

        const patched = this.applyPatchOperations(existing, ops, 'group');
        patched.updatedAt = new Date();
        patched.lastInteractionAt = new Date();

        await db.update(groupMemories)
            .set(this.serializeGroupMemory(patched))
            .where(eq(groupMemories.chatId, chatId))
            .run();

        const result = await this.getGroupMemory(chatId);
        return {
            success: true,
            data: result,
            message: `Group memory patched for ${existing.chatName}`,
            operation: 'patch',
            scope: 'group'
        };
    }

    // Operaciones de patch granulares
    private applyPatchOperations(data: any, ops: any, scope: string): any {
        const result = { ...data };

        if (!ops) return result;

        // SET: Reemplazar valores
        if (ops.set) {
            Object.keys(ops.set).forEach(key => {
                if (this.isValidField(key, scope)) {
                    result[key] = this.sanitizeValue(ops.set[key]);
                }
            });
        }

        // ADD: Agregar a arrays con deduplicación
        if (ops.add) {
            Object.keys(ops.add).forEach(key => {
                if (this.isArrayField(key, scope)) {
                    const existing = result[key] || [];
                    const toAdd = Array.isArray(ops.add[key]) ? ops.add[key] : [ops.add[key]];
                    const merged = [...existing, ...toAdd];
                    result[key] = [...new Set(merged)].slice(0, this.MAX_ARRAY_SIZE);
                }
            });
        }

        // REMOVE: Remover de arrays
        if (ops.remove) {
            Object.keys(ops.remove).forEach(key => {
                if (this.isArrayField(key, scope) && result[key]) {
                    const toRemove = Array.isArray(ops.remove[key]) ? ops.remove[key] : [ops.remove[key]];
                    result[key] = result[key].filter(item => !toRemove.includes(item));
                }
            });
        }

        // DELETE_FIELDS: Borrar campos completos
        if (ops.delete_fields && Array.isArray(ops.delete_fields)) {
            ops.delete_fields.forEach(field => {
                if (this.isValidField(field, scope) && !this.isRequiredField(field, scope)) {
                    delete result[field];
                }
            });
        }

        return result;
    }

    // Helpers para construcción de datos
    private buildUserUpdateData(existing: UserMemoryData, ops: any): UserMemoryData {
        const result = { ...existing };

        if (!ops || !ops.set) return result;

        Object.keys(ops.set).forEach(key => {
            if (this.isValidField(key, 'user')) {
                const value = ops.set[key];
                if (this.isArrayField(key, 'user')) {
                    result[key] = Array.isArray(value) ? value.slice(0, this.MAX_ARRAY_SIZE) : [value];
                } else {
                    result[key] = this.sanitizeValue(value);
                }
            }
        });

        return result;
    }

    private buildGroupUpdateData(existing: GroupMemoryData, ops: any): GroupMemoryData {
        const result = { ...existing };

        if (!ops || !ops.set) return result;

        Object.keys(ops.set).forEach(key => {
            if (this.isValidField(key, 'group')) {
                const value = ops.set[key];
                if (this.isArrayField(key, 'group')) {
                    result[key] = Array.isArray(value) ? value.slice(0, this.MAX_ARRAY_SIZE) : [value];
                } else {
                    result[key] = this.sanitizeValue(value);
                }
            }
        });

        return result;
    }

    // Validación y sanitización
    private sanitizeValue(value: any): any {
        if (typeof value === 'string') {
            return value.substring(0, this.MAX_STRING_LENGTH);
        }
        if (Array.isArray(value)) {
            return value.slice(0, this.MAX_ARRAY_SIZE);
        }
        if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value).slice(0, this.MAX_OBJECT_SIZE);
            const sanitized = {};
            keys.forEach(key => {
                sanitized[key] = typeof value[key] === 'string'
                    ? value[key].substring(0, this.MAX_STRING_LENGTH)
                    : value[key];
            });
            return sanitized;
        }
        return value;
    }

    private isValidField(field: string, scope: string): boolean {
        const userFields = ['age', 'profession', 'location', 'interests', 'likes', 'dislikes',
            'relationships', 'runningJokes', 'nicknames', 'personalNotes', 'jargon'];
        const groupFields = ['groupInterests', 'recurringTopics', 'groupLikes', 'groupDislikes',
            'groupJargon', 'groupRunningJokes', 'groupTraditions', 'groupNotes'];

        return scope === 'user' ? userFields.includes(field) : groupFields.includes(field);
    }

    private isArrayField(field: string, scope: string): boolean {
        const arrayFields = {
            user: ['interests', 'likes', 'dislikes', 'runningJokes', 'nicknames', 'personalNotes'],
            group: ['groupInterests', 'recurringTopics', 'groupLikes', 'groupDislikes',
                'groupRunningJokes', 'groupTraditions', 'groupNotes']
        };
        return arrayFields[scope].includes(field);
    }

    private isRequiredField(field: string, scope: string): boolean {
        const requiredFields = {
            user: ['chatId', 'authorId', 'authorName', 'isGroup'],
            group: ['chatId', 'chatName']
        };
        return requiredFields[scope].includes(field);
    }

    private async isTranscribedMessage(msgId: string): Promise<boolean> {
        // Implementar lógica para detectar si el mensaje es transcripción
        // Por ahora, asumir que no es transcripción
        return false;
    }

    // Métodos de serialización/deserialización (mantener existentes)
    private serializeUserMemory(data: UserMemoryData): any {
        return {
            ...data,
            interests: data.interests ? JSON.stringify(data.interests) : null,
            likes: data.likes ? JSON.stringify(data.likes) : null,
            dislikes: data.dislikes ? JSON.stringify(data.dislikes) : null,
            relationships: data.relationships ? JSON.stringify(data.relationships) : null,
            runningJokes: data.runningJokes ? JSON.stringify(data.runningJokes) : null,
            nicknames: data.nicknames ? JSON.stringify(data.nicknames) : null,
            personalNotes: data.personalNotes ? JSON.stringify(data.personalNotes) : null,
            jargon: data.jargon ? JSON.stringify(data.jargon) : null,
            createdAt: data.createdAt?.toISOString(),
            updatedAt: data.updatedAt?.toISOString(),
            lastInteractionAt: data.lastInteractionAt?.toISOString()
        };
    }

    private serializeGroupMemory(data: GroupMemoryData): any {
        return {
            ...data,
            groupInterests: data.groupInterests ? JSON.stringify(data.groupInterests) : null,
            recurringTopics: data.recurringTopics ? JSON.stringify(data.recurringTopics) : null,
            groupLikes: data.groupLikes ? JSON.stringify(data.groupLikes) : null,
            groupDislikes: data.groupDislikes ? JSON.stringify(data.groupDislikes) : null,
            groupJargon: data.groupJargon ? JSON.stringify(data.groupJargon) : null,
            groupRunningJokes: data.groupRunningJokes ? JSON.stringify(data.groupRunningJokes) : null,
            groupTraditions: data.groupTraditions ? JSON.stringify(data.groupTraditions) : null,
            groupNotes: data.groupNotes ? JSON.stringify(data.groupNotes) : null,
            createdAt: data.createdAt?.toISOString(),
            updatedAt: data.updatedAt?.toISOString(),
            lastInteractionAt: data.lastInteractionAt?.toISOString()
        };
    }

    private formatMemoriesForPrompt(userMemories: UserMemoryData[], groupMemory?: GroupMemoryData): string {
        let formattedText = '';

        // Format user memories
        if (userMemories.length > 0) {
            const userTexts = userMemories.map(memory => {
                const details = [];
                if (memory.age) details.push(`Age: ${memory.age}`);
                if (memory.profession) details.push(`Profession: ${memory.profession}`);
                if (memory.location) details.push(`Location: ${memory.location}`);
                if (memory.interests?.length) details.push(`Interests: ${memory.interests.join(', ')}`);
                if (memory.likes?.length) details.push(`Likes: ${memory.likes.join(', ')}`);
                if (memory.dislikes?.length) details.push(`Dislikes: ${memory.dislikes.join(', ')}`);
                if (memory.runningJokes?.length) details.push(`Running jokes: ${memory.runningJokes.join(', ')}`);
                if (memory.nicknames?.length) details.push(`Nicknames: ${memory.nicknames.join(', ')}`);
                if (memory.personalNotes?.length) details.push(`Notes: ${memory.personalNotes.join('; ')}`);
                if (memory.jargon && Object.keys(memory.jargon).length > 0) {
                    const jargonText = Object.entries(memory.jargon).map(([term, meaning]) => `${term}: ${meaning}`).join(', ');
                    details.push(`Personal jargon: ${jargonText}`);
                }

                return `• ${memory.authorName}: ${details.join(' | ')}`;
            }).join('\n');

            formattedText += `**REMEMBERED USER DATA:**\n${userTexts}`;
        }

        // Format group memory
        if (groupMemory) {
            const groupDetails = [];
            if (groupMemory.groupInterests?.length) groupDetails.push(`Group interests: ${groupMemory.groupInterests.join(', ')}`);
            if (groupMemory.recurringTopics?.length) groupDetails.push(`Recurring topics: ${groupMemory.recurringTopics.join(', ')}`);
            if (groupMemory.groupLikes?.length) groupDetails.push(`Group likes: ${groupMemory.groupLikes.join(', ')}`);
            if (groupMemory.groupDislikes?.length) groupDetails.push(`Group dislikes: ${groupMemory.groupDislikes.join(', ')}`);
            if (groupMemory.groupRunningJokes?.length) groupDetails.push(`Group running jokes: ${groupMemory.groupRunningJokes.join(', ')}`);
            if (groupMemory.groupTraditions?.length) groupDetails.push(`Group traditions: ${groupMemory.groupTraditions.join(', ')}`);
            if (groupMemory.groupNotes?.length) groupDetails.push(`Group notes: ${groupMemory.groupNotes.join('; ')}`);
            if (groupMemory.groupJargon && Object.keys(groupMemory.groupJargon).length > 0) {
                const jargonText = Object.entries(groupMemory.groupJargon).map(([term, meaning]) => `${term}: ${meaning}`).join(', ');
                groupDetails.push(`Group jargon: ${jargonText}`);
            }

            if (groupDetails.length > 0) {
                if (formattedText) formattedText += '\n\n';
                formattedText += `**GROUP MEMORY:**\n• ${groupMemory.chatName}: ${groupDetails.join(' | ')}`;
            }
        }

        return formattedText;
    }

    private mapRowToUserMemory(row: any): UserMemoryData {
        return {
            ...row,
            interests: row.interests ? JSON.parse(row.interests) : [],
            likes: row.likes ? JSON.parse(row.likes) : [],
            dislikes: row.dislikes ? JSON.parse(row.dislikes) : [],
            relationships: row.relationships ? JSON.parse(row.relationships) : {},
            runningJokes: row.runningJokes ? JSON.parse(row.runningJokes) : [],
            nicknames: row.nicknames ? JSON.parse(row.nicknames) : [],
            personalNotes: row.personalNotes ? JSON.parse(row.personalNotes) : [],
            jargon: row.jargon ? JSON.parse(row.jargon) : {},
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
            lastInteractionAt: new Date(row.lastInteractionAt)
        };
    }

    private mapRowToGroupMemory(row: any): GroupMemoryData {
        return {
            ...row,
            groupInterests: row.groupInterests ? JSON.parse(row.groupInterests) : [],
            recurringTopics: row.recurringTopics ? JSON.parse(row.recurringTopics) : [],
            groupLikes: row.groupLikes ? JSON.parse(row.groupLikes) : [],
            groupDislikes: row.groupDislikes ? JSON.parse(row.groupDislikes) : [],
            groupJargon: row.groupJargon ? JSON.parse(row.groupJargon) : {},
            groupRunningJokes: row.groupRunningJokes ? JSON.parse(row.groupRunningJokes) : [],
            groupTraditions: row.groupTraditions ? JSON.parse(row.groupTraditions) : [],
            groupNotes: row.groupNotes ? JSON.parse(row.groupNotes) : [],
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
            lastInteractionAt: new Date(row.lastInteractionAt)
        };
    }
}

const MemoryService = new MemoryServiceClass();
export default MemoryService;