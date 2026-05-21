export type WhatsAppMessageType =
  | 'chat'
  | 'image'
  | 'sticker'
  | 'audio'
  | 'voice'
  | 'document'
  | 'unknown';

export interface WhatsAppParticipant {
  id: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

export interface WhatsAppChat {
  id: string;
  name?: string;
  isGroup: boolean;
  participants?: WhatsAppParticipant[];
}

export interface WhatsAppMedia {
  mimetype: string;
  data: string;
  filename?: string;
}

export interface WhatsAppContact {
  id: string;
  number?: string;
  pushName?: string;
  name?: string;
  shortName?: string;
}

export interface WhatsAppMessage {
  id: string;
  chatId: string;
  authorId: string;
  participantId?: string;
  fromMe: boolean;
  body: string;
  timestamp: number;
  type: WhatsAppMessageType;
  hasQuotedMsg: boolean;
  quotedMsgId?: string;
  mentionedJids?: string[];
  pushName?: string;
}

export interface SerializedMessageKey {
  chatId: string;
  messageId: string;
  participantId?: string;
  fromMe?: boolean;
}

export interface SendTextOptions {
  quotedMessageId?: string;
  linkPreview?: boolean;
}

export interface SendMediaOptions {
  caption?: string;
  asSticker?: boolean;
  asVoice?: boolean;
  quotedMessageId?: string;
}

export interface ReplyOptions extends SendMediaOptions, SendTextOptions {}

export interface WhatsAppClient {
  getChatById(chatId: string): Promise<WhatsAppChat | null>;
  getMessageById(messageId: string): Promise<WhatsAppMessage | null>;
  getRawMessageForBaileys(keyOrMessageId: SerializedMessageKey | string): Promise<unknown>;
  sendText(chatId: string, text: string, options?: SendTextOptions): Promise<unknown>;
  sendMedia(chatId: string, media: WhatsAppMedia, options?: SendMediaOptions): Promise<unknown>;
  reply(messageOrId: WhatsAppMessage | string, payload: string | WhatsAppMedia, options?: ReplyOptions): Promise<unknown>;
  react(messageOrId: WhatsAppMessage | string, emoji: string): Promise<unknown>;
  sendTyping(chatId: string): Promise<void>;
  clearTyping(chatId: string): Promise<void>;
  fetchRecentMessages(chatId: string, limit: number): Promise<WhatsAppMessage[]>;
  downloadMedia(messageOrId: WhatsAppMessage | string): Promise<WhatsAppMedia | null>;
  getBotJid(): string | undefined;
}

export function normalizeChatId(chatId?: string | null): string {
  const value = (chatId ?? '').trim();
  if (!value) return '';
  return value.replace(/@c\.us$/i, '@s.whatsapp.net');
}

export function normalizeAuthorId(authorId?: string | null): string {
  return normalizeChatId(authorId);
}

export function normalizeComparableNumber(value?: string | null): string {
  const normalized = normalizeAuthorId(value);
  if (!normalized) return '';
  return normalized.split('@')[0].replace(/\D/g, '');
}

export function serializeMessageId(key: SerializedMessageKey): string {
  const chatId = normalizeChatId(key.chatId);
  const participantId = normalizeAuthorId(key.participantId);
  const fromMe = key.fromMe ? '1' : '0';
  return [chatId, key.messageId, participantId, fromMe].join('::');
}

export function deserializeMessageId(serializedId?: string | null): SerializedMessageKey | null {
  if (!serializedId) return null;

  const [chatId, messageId, participantId, fromMe] = serializedId.split('::');
  if (!chatId || !messageId) return null;

  return {
    chatId: normalizeChatId(chatId),
    messageId,
    participantId: participantId ? normalizeAuthorId(participantId) : undefined,
    fromMe: fromMe === '1'
  };
}
