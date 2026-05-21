import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  getContentType,
  isJidBroadcast,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  type Contact,
  type ConnectionState,
  type GroupMetadata,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import NodeCache from 'node-cache';
import logger from '../logger';
import {
  deserializeMessageId,
  serializeMessageId,
  WhatsAppMedia,
} from './whatsapp-types';
import { BaileysAuthStore } from './baileys-auth-store';
import { MessageStore, messageStore as globalMessageStore } from './message-store';
import { normalizeWAMessage } from './baileys-message-normalizer';

const AUTH_DIR = process.env.BAILEYS_AUTH_DIR || 'session-baileys';


export const MessageTypes = {
  AUDIO: 'audio',
  CHAT: 'chat',
  DOCUMENT: 'document',
  IMAGE: 'image',
  STICKER: 'sticker',
  UNKNOWN: 'unknown',
  VOICE: 'voice',
} as const;

type SupportedMessageType = typeof MessageTypes[keyof typeof MessageTypes];

function getComparableUser(contactId?: string) {
  return (contactId || '').split('@')[0];
}

class ContactAdapter {
  public id: { user: string; _serialized: string };
  public shortName?: string;
  public name?: string;
  public pushname?: string;
  public number?: string;

  constructor(contactId: string, contact?: Partial<Contact>) {
    const normalizedId = jidNormalizedUser(contactId);
    this.id = {
      user: getComparableUser(normalizedId),
      _serialized: normalizedId,
    };
    this.shortName = contact?.notify;
    this.name = contact?.name;
    this.pushname = contact?.notify;
    this.number = getComparableUser(normalizedId);
  }
}

class ChatAdapter {
  public id: { _serialized: string };
  public name?: string;
  public isGroup: boolean;
  public participants: Array<{ id: { _serialized: string }; isAdmin?: boolean; isSuperAdmin?: boolean }>;

  constructor(private client: WhatsAppClientRuntime, private chatId: string, metadata?: Partial<GroupMetadata>) {
    this.id = { _serialized: chatId };
    this.name = metadata?.subject || metadata?.subjectOwner || metadata?.owner || undefined;
    this.isGroup = chatId.endsWith('@g.us');
    this.participants = (metadata?.participants || []).map(participant => ({
      id: { _serialized: jidNormalizedUser(participant.id) },
      isAdmin: participant.admin === 'admin' || participant.admin === 'superadmin',
      isSuperAdmin: participant.admin === 'superadmin',
    }));
  }

  async fetchMessages({ limit }: { limit: number }) {
    return this.client.fetchRecentMessages(this.chatId, limit);
  }

  async sendStateTyping() {
    await this.client.sendTyping(this.chatId);
  }

  async clearState() {
    await this.client.clearTyping(this.chatId);
  }
}

class MessageAdapter {
  public id: { _serialized: string; remote?: string; participant?: string };
  public body: string;
  public timestamp: number;
  public type: SupportedMessageType;
  public fromMe: boolean;
  public from: string;
  public author?: string;
  public hasQuotedMsg: boolean;

  constructor(private client: WhatsAppClientRuntime, public readonly raw: WAMessage) {
    const key = raw.key;
    this.id = {
      _serialized: serializeMessageId({
        chatId: key.remoteJid!,
        messageId: key.id!,
        participantId: key.participant,
        fromMe: key.fromMe,
      }),
      remote: key.remoteJid || undefined,
      participant: key.participant || undefined,
    };
    this.timestamp = Number(raw.messageTimestamp || 0);
    this.type = client.getMessageType(raw);
    this.body = client.extractBody(raw);
    this.fromMe = !!key.fromMe;
    this.from = key.remoteJid || '';
    this.author = key.participant || key.remoteJid || undefined;
    this.hasQuotedMsg = !!client.getQuotedKey(raw);
  }

  async getChat() {
    return this.client.getChatById(this.from);
  }

  async getContact() {
    const contactId = this.author || this.from;
    return this.client.getContact(contactId, this.raw.pushName);
  }

  async getQuotedMessage() {
    const quotedKey = this.client.getQuotedKey(this.raw);
    if (!quotedKey) return null;
    return this.client.getMessageByKey(quotedKey);
  }

  async downloadMedia() {
    return this.client.downloadMedia(this);
  }

  async reply(payload: string | WhatsAppMedia, _chatId?: string, options?: { asSticker?: boolean; asVoice?: boolean; linkPreview?: boolean }) {
    return this.client.reply(this, payload, options);
  }

  async react(emoji: string) {
    return this.client.react(this, emoji);
  }
}

class WhatsAppClientRuntime {
  private socket: WASocket | null = null;
  private readonly authStore = new BaileysAuthStore(AUTH_DIR);
  private readonly messageStore = globalMessageStore;
  private readonly groupCache = new NodeCache({ stdTTL: 300 });
  private readonly contactCache = new NodeCache({ stdTTL: 3600 });
  private isReconnecting = false;

  async connect() {
    logger.info('Starting WhatsApp client...');
    const auth = await this.authStore.load();
    await this.createSocket(auth);
  }

  private async createSocket(auth: any) {
    const baileysLogger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });

    this.socket = makeWASocket({
      auth,
      logger: baileysLogger,
      getMessage: async (key: WAMessageKey) => this.messageStore.getProtoMessage(key),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      cachedGroupMetadata: async (jid: string) => {
        return this.groupCache.get<GroupMetadata>(jid);
      },
    });

    this.socket.ev.on('creds.update', update => {
      this.authStore.updateCreds(update);
    });

    this.socket.ev.on('connection.update', update => {
      void this.handleConnectionUpdate(update);
    });

    this.socket.ev.on('messaging-history.set', ({ messages }) => {
      this.messageStore.addMessages(messages);
    });

    this.socket.ev.on('contacts.upsert', contacts => {
      for (const contact of contacts) {
        if (contact.id) {
          this.contactCache.set(jidNormalizedUser(contact.id), contact);
        }
      }
    });

    this.socket.ev.on('contacts.update', contacts => {
      for (const contact of contacts) {
        if (contact.id) {
          const current = this.contactCache.get<Contact>(jidNormalizedUser(contact.id)) || {};
          this.contactCache.set(jidNormalizedUser(contact.id), { ...current, ...contact });
        }
      }
    });

    this.socket.ev.on('groups.upsert', groups => {
      for (const group of groups) {
        if (group.id) {
          this.groupCache.set(group.id, group);
        }
      }
    });

    this.socket.ev.on('groups.update', groups => {
      for (const group of groups) {
        if (!group.id) continue;
        const current = this.groupCache.get<GroupMetadata>(group.id) || ({ id: group.id } as GroupMetadata);
        this.groupCache.set(group.id, { ...current, ...group });
      }
    });

    this.socket.ev.on('messages.upsert', event => {
      void this.handleMessagesUpsert(event);
    });
  }

  private async handleConnectionUpdate(update: Partial<ConnectionState>) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('QR Code received, scan please');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      logger.info('Client is ready!');
      this.isReconnecting = false;
      await this.authStore.flush();
      return;
    }

    if (connection !== 'close') {
      return;
    }

    const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;

    if (statusCode === DisconnectReason.loggedOut) {
      logger.error('Authentication lost or logged out. A new QR scan is required.');
      await this.authStore.flush();
      return;
    }

    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    logger.warn(`Connection closed (${statusCode ?? 'unknown'}). Reconnecting...`);
    await this.authStore.flush();
    await this.createSocket(await this.authStore.load());
  }

  private async handleMessagesUpsert(event: { messages: WAMessage[]; type: string }) {
    if (event.type !== 'notify') return;

    for (const message of event.messages) {
      if (!this.shouldHandleMessage(message)) continue;

      this.messageStore.addMessage(message);
      const { default: Roboto } = await import('./roboto');
      await Roboto.readWspMessage(normalizeWAMessage(message));
    }
  }

  private shouldHandleMessage(message: WAMessage) {
    const remoteJid = message.key.remoteJid;
    if (!remoteJid) return false;
    if (isJidStatusBroadcast(remoteJid)) return false;
    if (isJidNewsletter(remoteJid)) return false;
    if (isJidBroadcast(remoteJid) && !message.key.fromMe) return false;
    if (!message.message) return false;
    if (!this.extractBody(message) && !normalizeMessageContent(message.message)) return false;
    return true;
  }

  getMessageType(message: WAMessage): SupportedMessageType {
    const content = normalizeMessageContent(message.message);
    const contentType = getContentType(content);

    switch (contentType) {
      case 'conversation':
      case 'extendedTextMessage':
        return MessageTypes.CHAT;
      case 'imageMessage':
        return MessageTypes.IMAGE;
      case 'stickerMessage':
        return MessageTypes.STICKER;
      case 'audioMessage':
        return content?.audioMessage?.ptt ? MessageTypes.VOICE : MessageTypes.AUDIO;
      case 'documentMessage':
        return MessageTypes.DOCUMENT;
      default:
        return MessageTypes.UNKNOWN;
    }
  }

  extractBody(message: WAMessage): string {
    const content = normalizeMessageContent(message.message);
    return (
      content?.conversation ||
      content?.extendedTextMessage?.text ||
      content?.imageMessage?.caption ||
      content?.documentMessage?.caption ||
      ''
    );
  }

  getQuotedKey(message: WAMessage): WAMessageKey | null {
    const content = normalizeMessageContent(message.message);
    const contentType = getContentType(content);
    if (!contentType) return null;

    const contextInfo = (content as any)[contentType]?.contextInfo;
    if (!contextInfo?.stanzaId) return null;

    return {
      remoteJid: contextInfo.remoteJid || message.key.remoteJid,
      id: contextInfo.stanzaId,
      participant: contextInfo.participant,
      fromMe: false,
    };
  }

  toMessageAdapter(message: WAMessage) {
    return new MessageAdapter(this, message);
  }

  async getContact(contactId: string, pushName?: string) {
    const normalizedId = jidNormalizedUser(contactId);
    const cached = this.contactCache.get<Contact>(normalizedId);
    if (cached) return new ContactAdapter(normalizedId, cached);
    return new ContactAdapter(normalizedId, { notify: pushName });
  }

  async getChatById(chatId: string) {
    const normalizedChatId = jidNormalizedUser(chatId);
    let metadata = this.groupCache.get<GroupMetadata>(normalizedChatId);

    if (!metadata && normalizedChatId.endsWith('@g.us') && this.socket) {
      metadata = await this.socket.groupMetadata(normalizedChatId);
      this.groupCache.set(normalizedChatId, metadata);
    }

    return new ChatAdapter(this, normalizedChatId, metadata);
  }

  async getMessageByKey(key: WAMessageKey) {
    const message = this.messageStore.getMessageByKey(key);
    return message ? this.toMessageAdapter(message) : null;
  }

  async getMessageById(messageId: string) {
    const message = this.messageStore.getMessageBySerializedId(messageId);
    return message ? this.toMessageAdapter(message) : null;
  }

  async sendMessage(chatId: string, payload: string | WhatsAppMedia, options?: { asSticker?: boolean; linkPreview?: boolean }) {
    if (!this.socket) throw new Error('WhatsApp socket is not connected');

    let sent: WAMessage | undefined;
    if (typeof payload === 'string') {
      sent = await this.socket.sendMessage(jidNormalizedUser(chatId), { text: payload });
    } else if (options?.asSticker) {
      sent = await this.socket.sendMessage(jidNormalizedUser(chatId), {
        sticker: Buffer.from(payload.data, 'base64'),
      });
    } else if (payload.mimetype.startsWith('image/')) {
      sent = await this.socket.sendMessage(jidNormalizedUser(chatId), {
        image: Buffer.from(payload.data, 'base64'),
        mimetype: payload.mimetype,
        fileName: payload.filename,
      });
    } else if (payload.mimetype.startsWith('audio/')) {
      sent = await this.socket.sendMessage(jidNormalizedUser(chatId), {
        audio: Buffer.from(payload.data, 'base64'),
        mimetype: payload.mimetype,
      });
    } else {
      sent = await this.socket.sendMessage(jidNormalizedUser(chatId), {
        document: Buffer.from(payload.data, 'base64'),
        mimetype: payload.mimetype,
        fileName: payload.filename,
      });
    }

    if (sent) {
      this.messageStore.addMessage(sent);
      return this.toMessageAdapter(sent);
    }

    return null;
  }

  async reply(message: MessageAdapter | string, payload: string | WhatsAppMedia, options?: { asSticker?: boolean; asVoice?: boolean; linkPreview?: boolean }) {
    if (!this.socket) throw new Error('WhatsApp socket is not connected');

    const target = typeof message === 'string' ? await this.getMessageById(message) : message;
    if (!target) throw new Error('Quoted message not found in store');

    const chatId = target.raw.key.remoteJid!;
    const quoted = target.raw;
    let sent: WAMessage | undefined;

    if (typeof payload === 'string') {
      sent = await this.socket.sendMessage(chatId, { text: payload }, { quoted });
    } else if (options?.asSticker) {
      sent = await this.socket.sendMessage(chatId, { sticker: Buffer.from(payload.data, 'base64') }, { quoted });
    } else if (payload.mimetype.startsWith('audio/')) {
      sent = await this.socket.sendMessage(chatId, {
        audio: Buffer.from(payload.data, 'base64'),
        mimetype: payload.mimetype,
        ptt: !!options?.asVoice,
      }, { quoted });
    } else if (payload.mimetype.startsWith('image/')) {
      sent = await this.socket.sendMessage(chatId, {
        image: Buffer.from(payload.data, 'base64'),
        mimetype: payload.mimetype,
        fileName: payload.filename,
      }, { quoted });
    } else {
      sent = await this.socket.sendMessage(chatId, {
        document: Buffer.from(payload.data, 'base64'),
        mimetype: payload.mimetype,
        fileName: payload.filename,
      }, { quoted });
    }

    if (sent) {
      this.messageStore.addMessage(sent);
      return this.toMessageAdapter(sent);
    }

    return null;
  }

  async react(message: MessageAdapter | string, emoji: string) {
    if (!this.socket) throw new Error('WhatsApp socket is not connected');
    const target = typeof message === 'string' ? await this.getMessageById(message) : message;
    if (!target) return null;

    return this.socket.sendMessage(target.raw.key.remoteJid!, {
      react: {
        text: emoji,
        key: target.raw.key,
      },
    });
  }

  async sendTyping(chatId: string) {
    if (!this.socket) return;
    await this.socket.sendPresenceUpdate('composing', jidNormalizedUser(chatId));
  }

  async clearTyping(chatId: string) {
    if (!this.socket) return;
    await this.socket.sendPresenceUpdate('paused', jidNormalizedUser(chatId));
  }

  async fetchRecentMessages(chatId: string, limit: number) {
    return this.messageStore.getRecentMessages(jidNormalizedUser(chatId), limit).map(message => this.toMessageAdapter(message));
  }

  async downloadMedia(message: MessageAdapter | string) {
    if (!this.socket) throw new Error('WhatsApp socket is not connected');

    const target = typeof message === 'string' ? await this.getMessageById(message) : message;
    if (!target) return null;

    const buffer = await downloadMediaMessage(target.raw, 'buffer', {}, {
      logger: pino({ level: 'silent' }),
      reuploadRequest: async msg => this.socket!.updateMediaMessage(msg),
    });

    const content = normalizeMessageContent(target.raw.message);
    const contentType = getContentType(content);
    const mediaNode = contentType ? (content as any)[contentType] : undefined;

    return {
      mimetype: mediaNode?.mimetype || 'application/octet-stream',
      data: buffer.toString('base64'),
      filename: mediaNode?.fileName,
    } satisfies WhatsAppMedia;
  }

  async getRawMessageForBaileys(keyOrMessageId: WAMessageKey | string) {
    if (typeof keyOrMessageId !== 'string') {
      return this.messageStore.getMessageByKey(keyOrMessageId);
    }

    const parsed = deserializeMessageId(keyOrMessageId);
    if (!parsed) return null;

    return this.messageStore.getMessageBySerializedId(
      serializeMessageId({
        chatId: parsed.chatId,
        messageId: parsed.messageId,
        participantId: parsed.participantId,
        fromMe: parsed.fromMe,
      })
    );
  }

  getBotJid() {
    return this.socket?.user?.id ? jidNormalizedUser(this.socket.user.id) : undefined;
  }
}

const whatsappClient = new WhatsAppClientRuntime();

export async function connectWhatsApp() {
  await whatsappClient.connect();
}

export function getWhatsAppClient() {
  return whatsappClient;
}

export type ClientMessage = MessageAdapter;
export type ClientChat = ChatAdapter;
