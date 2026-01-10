import NodeCache from "node-cache";
import { CONFIG } from "../config";

class LLMMessagesCache {
    private _messagesCache = new NodeCache();
    private _proxies = new Map<string, any[]>();

    public getMessages(chatId: string): any[] {
        // Si ya existe un proxy, retornarlo
        if (this._proxies.has(chatId)) {
            return this._proxies.get(chatId)!;
        }

        // Obtiene mensajes del cache o crea array vacío
        const messages: any[] = this._messagesCache.get(chatId) || [];

        // Crea proxy que intercepta modificaciones
        const proxy = new Proxy(messages, {
            set: (target, property, value) => {
                target[property] = value;
                // Auto-actualizar cache en cada modificación
                this._messagesCache.set(chatId, target, CONFIG.BotConfig.nodeCacheTime);
                return true;
            },
            deleteProperty: (target, property) => {
                delete target[property];
                this._messagesCache.set(chatId, target, CONFIG.BotConfig.nodeCacheTime);
                return true;
            }
        });

        this._proxies.set(chatId, proxy);
        return proxy;
    }

    public deleteChatCache(chatId: string): void {
        this._messagesCache.del(chatId);
        this._proxies.delete(chatId);
    }

    public hasChatCache(chatId: string): boolean {
        return this._messagesCache.has(chatId);
    }
}

const LLMMessages = new LLMMessagesCache();
export default LLMMessages;