import NodeCache from "node-cache";
import { CONFIG } from "../config";
import { AIRole } from "../interfaces/ai-interfaces";
import logger from "../logger";

interface CacheEntry {
    messages: any[];
    locked: boolean;
}

class LLMMessagesCache {
    private _messagesCache = new NodeCache();
    private _entries = new Map<string, CacheEntry>();

    public getMessages(chatId: string): any[] {
        if (!this._entries.has(chatId)) {
            const cached = this._messagesCache.get<any[]>(chatId) || [];
            this._entries.set(chatId, {
                messages: cached,
                locked: false
            });
        }
        return this._entries.get(chatId)!.messages;
    }

    public saveMessages(chatId: string): void {
        const entry = this._entries.get(chatId);
        if (!entry) return;

        this._messagesCache.set(chatId, entry.messages, CONFIG.BotConfig.nodeCacheTime);
    }

    public lock(chatId: string): void {
        const entry = this._entries.get(chatId);
        if (entry) entry.locked = true;
    }

    public unlock(chatId: string): void {
        const entry = this._entries.get(chatId);
        if (entry) entry.locked = false;
    }

    public isLocked(chatId: string): boolean {
        return this._entries.get(chatId)?.locked || false;
    }

    public deleteChatCache(chatId: string): void {
        this._messagesCache.del(chatId);
        this._entries.delete(chatId);
    }

    public hasChatCache(chatId: string): boolean {
        return this._messagesCache.has(chatId) || this._entries.has(chatId);
    }

    public trimMessages(chatId: string, maxMessages: number): void {
        const entry = this._entries.get(chatId);
        if (!entry) return;

        const messages = entry.messages;
        if (messages.length <= maxMessages) return;

        const startIndex = Math.max(0, messages.length - maxMessages);

        let safeIndex = startIndex;
        for (let i = startIndex; i < messages.length; i++) {
            const msg = messages[i];

            if (msg.role === AIRole.USER || msg.role === AIRole.SYSTEM) {
                safeIndex = i;
                break;
            }
        }

        safeIndex = this.findSafeCutPoint(messages, safeIndex);

        if (safeIndex > 0) {
            const removed = messages.splice(0, safeIndex);
            logger.debug(`[LLMCache] Trimmed ${removed.length} messages from chat ${chatId}`);
        }

        this.saveMessages(chatId);
    }

    private findSafeCutPoint(messages: any[], proposedIndex: number): number {
        let index = proposedIndex;

        while (index > 0) {
            const msg = messages[index];
            const prevMsg = messages[index - 1];

            if (prevMsg?.type === 'function_call' || msg?.type === 'function_call_output') {
                index--;
                continue;
            }

            if (prevMsg?.role === AIRole.ASSISTANT && prevMsg?.content?.some((c: any) => c.type === 'tool_use')) {
                if (msg?.role === AIRole.USER && msg?.content?.some((c: any) => c.type === 'tool_result')) {
                    index--;
                    continue;
                }
            }

            break;
        }

        return index;
    }

    public estimateTokens(chatId: string): number {
        const messages = this.getMessages(chatId);
        let totalChars = 0;

        for (const msg of messages) {
            if (msg.content) {
                if (typeof msg.content === 'string') {
                    totalChars += msg.content.length;
                } else if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part.text) totalChars += part.text.length;
                        if (part.value) totalChars += part.value.length;
                    }
                }
            }
        }

        return Math.ceil(totalChars / 4);
    }
}

const LLMMessages = new LLMMessagesCache();
export default LLMMessages;