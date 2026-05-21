import type { proto, WAMessage, WAMessageKey } from 'baileys';
import { deserializeMessageId, serializeMessageId } from './whatsapp-types';

function serializeKey(key: WAMessageKey): string | null {
  if (!key.remoteJid || !key.id) return null;

  return serializeMessageId({
    chatId: key.remoteJid,
    messageId: key.id,
    participantId: key.participant,
    fromMe: key.fromMe,
  });
}

export class MessageStore {
  private readonly messages = new Map<string, WAMessage>();
  private readonly byChat = new Map<string, string[]>();

  constructor(private readonly maxMessagesPerChat = 200) {}

  addMessage(message: WAMessage) {
    const serializedId = serializeKey(message.key);
    if (!serializedId) return;

    this.messages.set(serializedId, message);

    const chatId = message.key.remoteJid!;
    const ids = this.byChat.get(chatId) || [];
    ids.push(serializedId);

    while (ids.length > this.maxMessagesPerChat) {
      const removedId = ids.shift();
      if (removedId) {
        this.messages.delete(removedId);
      }
    }

    this.byChat.set(chatId, ids);
  }

  addMessages(messages: WAMessage[]) {
    for (const message of messages) {
      this.addMessage(message);
    }
  }

  getMessageBySerializedId(messageId: string): WAMessage | null {
    return this.messages.get(messageId) || null;
  }

  getMessageByKey(key: WAMessageKey): WAMessage | null {
    const serializedId = serializeKey(key);
    if (!serializedId) return null;
    return this.getMessageBySerializedId(serializedId);
  }

  getProtoMessage(key: WAMessageKey): proto.IMessage | undefined {
    return this.getMessageByKey(key)?.message || undefined;
  }

  getRecentMessages(chatId: string, limit: number): WAMessage[] {
    const ids = this.byChat.get(chatId) || [];
    return ids.slice(-limit).map(id => this.messages.get(id)).filter(Boolean);
  }

  resolveQuotedMessageId(chatId: string, stanzaId?: string | null, participantId?: string | null): string | undefined {
    if (!stanzaId) return undefined;

    const candidate = serializeMessageId({
      chatId,
      messageId: stanzaId,
      participantId: participantId ?? undefined,
      fromMe: false,
    });

    if (this.messages.has(candidate)) {
      return candidate;
    }

    const ids = this.byChat.get(chatId) || [];
    const match = ids.find(id => {
      const parsed = deserializeMessageId(id);
      return parsed?.messageId === stanzaId;
    });

    return match;
  }
}

export const messageStore = new MessageStore();
