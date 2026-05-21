import { AIContent, AiMessage, AIRole } from "../interfaces/ai-interfaces";
import { bufferToStream, getFormattedDate, getUnsupportedMessage, getUserNameFromWhatsAppMessage } from "../utils";
import logger from "../logger";
import NodeCache from "node-cache";
import OpenAISvc from "../services/openai-service";
import { CONFIG } from "../config";
import { ChatConfiguration, chatConfigurationManager } from "../config/chat-configurations";
import { ClientChat as Chat, ClientMessage as Message, getWhatsAppClient } from "./whatsapp-client";
import { WhatsAppMedia, WhatsAppMessage } from "./whatsapp-types";
import { normalizeWAMessage } from "./baileys-message-normalizer";
import { messageStore } from "./message-store";

class WhatsAppMessageService {
  private msgMediaCache: NodeCache = new NodeCache();
  private transcribedMessagesCache: NodeCache = new NodeCache();
  private lastProcessed = new Map<string, string>();

  public async generateMessageArray(wspMessage: WhatsAppMessage | Message, chatData: Chat, chatCfg: ChatConfiguration, chatCached: boolean): Promise<AiMessage[]> {
    const currentMsg = 'raw' in wspMessage ? normalizeWAMessage(wspMessage.raw) : wspMessage;
    const chatId = currentMsg.chatId;
    const isGroup = chatId.endsWith('@g.us');
    const lastChatMsgProcessed = this.lastProcessed.get(chatId);

    const rawMessages = messageStore.getRecentMessages(chatId, chatCfg.maxMsgsLimit);
    const messages = rawMessages.map(normalizeWAMessage);

    const resetIndex = messages.map(m => m.body).lastIndexOf('-reset');
    const messagesToProcess = resetIndex >= 0 ? messages.slice(resetIndex + 1) : messages;

    const currentIdx = messagesToProcess.findIndex(m => m.id === currentMsg.id);
    const endIdx = currentIdx !== -1 ? currentIdx : messagesToProcess.length - 1;
    const messagesToProcessFiltered = messagesToProcess.slice(0, endIdx + 1);

    if (chatCached && !isGroup) {
      const aiMessage = await this.convertWspMsgToAiMsg(currentMsg, chatCfg.botName);
      this.lastProcessed.set(chatId, currentMsg.id);
      return [aiMessage];
    }

    const messageList: AiMessage[] = [];

    for (const msg of [...messagesToProcessFiltered].reverse()) {
      try {
        const actualDate = new Date();
        const msgDate = new Date(msg.timestamp * 1000);

        if ((actualDate.getTime() - msgDate.getTime()) / (1000 * 60 * 60) > chatCfg.maxHoursLimit) break;
        if (lastChatMsgProcessed === msg.id) break;
        if (chatCached && msg.fromMe) break;
        if (currentMsg.timestamp < msg.timestamp) continue;

        const aiMessage = await this.convertNormalizedMsgToAiMsg(msg, chatCfg.botName);
        messageList.push(aiMessage);
      } catch (e: any) {
        logger.error(`Error reading message - msg.type:${msg.type}; msg.body:${msg.body}. Error:${e.message}`);
      }
    }

    this.lastProcessed.set(chatId, currentMsg.id);
    return messageList.reverse() || [];
  }

  public async extractMedia(wspMsg: WhatsAppMessage | Message): Promise<{ errorMedia: string | null, mediaData: WhatsAppMedia | null }> {
    const msg = 'raw' in wspMsg ? normalizeWAMessage(wspMsg.raw) : wspMsg;
    let mediaData: WhatsAppMedia | null = this.msgMediaCache.get<WhatsAppMedia>(msg.id) ?? null;
    const isImage = msg.type === 'image' || msg.type === 'sticker';

    if (!mediaData) {
      mediaData = await getWhatsAppClient().downloadMedia(msg.id) ?? null;
    }

    if (mediaData) {
      if (!mediaData.mimetype.startsWith('image') && mediaData.mimetype !== 'application/pdf')
        return { errorMedia: 'type', mediaData: null };

      const sizeInMB = Buffer.from(mediaData.data, 'base64').length / (1024 * 1024);
      const maxMB = isImage
        ? CONFIG.BotConfig.maxImageSizeMB
        : CONFIG.BotConfig.maxDocumentSizeMB;

      if (sizeInMB > maxMB) {
        logger.warn(`Rejected file: ${sizeInMB.toFixed(2)}MB (limit: ${maxMB}MB)`);
        return { errorMedia: 'size', mediaData: null };
      }
      this.msgMediaCache.set(msg.id, mediaData, CONFIG.BotConfig.nodeCacheTime);
      return { errorMedia: null, mediaData };
    }
    return { errorMedia: null, mediaData: null };
  }

  public async convertWspMsgToAiMsg(wspMsg: WhatsAppMessage | Message, inputBotName?: string): Promise<AiMessage> {
    const normalized = 'raw' in wspMsg ? normalizeWAMessage(wspMsg.raw) : wspMsg;
    return this.convertNormalizedMsgToAiMsg(normalized, inputBotName);
  }

  private async convertNormalizedMsgToAiMsg(wspMsg: WhatsAppMessage, inputBotName?: string): Promise<AiMessage> {
    let mediaData: WhatsAppMedia | null = this.msgMediaCache.get<WhatsAppMedia>(wspMsg.id) ?? null;
    let errorMedia: string | null = null;
    const msgDate = new Date(wspMsg.timestamp * 1000);
    const author_id = wspMsg.authorId;
    const botName = inputBotName ?? (await chatConfigurationManager.getChatConfig(wspMsg.chatId)).botName;
    const quoted_msg_id = wspMsg.quotedMsgId;

    const isImage = wspMsg.type === 'image' || wspMsg.type === 'sticker';
    const isSticker = wspMsg.type === 'sticker';
    const isAudio = wspMsg.type === 'voice' || wspMsg.type === 'audio';
    const isDocument = wspMsg.type === 'document';

    if (!mediaData && (isImage || isDocument)) {
      ({ mediaData, errorMedia } = await this.extractMedia(wspMsg));
    }

    const isOther = (!isImage && !isDocument && !isAudio && wspMsg.type !== 'chat') || errorMedia === 'type';

    const role = (!wspMsg.fromMe || isImage) ? AIRole.USER : AIRole.ASSISTANT;
    const name = wspMsg.fromMe ? botName : (await getUserNameFromWhatsAppMessage(wspMsg));

    const content: AIContent[] = [];

    if (isImage) {
      if (mediaData) {
        content.push({
          type: 'image',
          value: mediaData.data,
          mimetype: mediaData.mimetype,
          msg_id: wspMsg.id,
          quoted_msg_id,
          filename: isSticker ? 'sticker' : 'image',
          author_id,
          dateString: getFormattedDate(msgDate),
        });
      } else {
        content.push({
          type: 'text',
          msg_id: wspMsg.id,
          quoted_msg_id,
          value: '<Unprocessed image>',
          author_id,
          dateString: getFormattedDate(msgDate),
        });
      }
    }

    if (isAudio) {
      content.push({
        type: 'ASR',
        msg_id: wspMsg.id,
        quoted_msg_id,
        value: await this.transcribeVoice(wspMsg),
        author_id,
        dateString: getFormattedDate(msgDate),
      });
    }

    if (isDocument && mediaData) {
      content.push({
        type: 'file',
        msg_id: wspMsg.id,
        quoted_msg_id,
        mimetype: mediaData.mimetype,
        filename: mediaData.filename,
        value: mediaData.data,
        author_id,
        dateString: getFormattedDate(msgDate),
      });
    }

    if (errorMedia || (isOther && !mediaData)) {
      let errorMessage = getUnsupportedMessage(wspMsg.type, wspMsg.body);
      if (errorMedia === 'size')
        errorMessage = `SYSTEM:⚠️ The file could not be processed because it exceeds the maximum allowed size (${isImage ? CONFIG.BotConfig.maxImageSizeMB : CONFIG.BotConfig.maxDocumentSizeMB}MB).`;
      content.push({
        type: 'text',
        msg_id: wspMsg.id,
        quoted_msg_id,
        value: errorMessage,
        author_id,
        dateString: getFormattedDate(msgDate),
      });
    }

    if (wspMsg.body && !isOther) {
      content.push({
        type: 'text',
        msg_id: wspMsg.id,
        quoted_msg_id,
        value: wspMsg.body,
        author_id,
        dateString: getFormattedDate(msgDate),
      });
    }

    return { role, name, content };
  }

  private async transcribeVoice(wspMsg: WhatsAppMessage): Promise<string> {
    try {
      const cached = this.transcribedMessagesCache.get<string>(wspMsg.id);
      if (cached) return cached;

      const media = await getWhatsAppClient().downloadMedia(wspMsg.id);
      if (!media) return '<Error transcribing voice message>';

      const audioBuffer = Buffer.from(media.data, 'base64');
      const audioStream = bufferToStream(audioBuffer);

      logger.debug(`[OpenAI->transcribeVoice] Starting audio transcription`);
      const transcribedText = await OpenAISvc.transcription(audioStream);
      logger.debug(`[OpenAI->transcribeVoice] Transcribed text: ${transcribedText}`);

      this.transcribedMessagesCache.set<string>(wspMsg.id, transcribedText, CONFIG.BotConfig.nodeCacheTime);
      return transcribedText;
    } catch (error: any) {
      logger.error(`Error transcribing voice message: ${error.message}`);
      return '<Error transcribing voice message>';
    }
  }

  public returnResponse(message: Message, responseMsg: string, isGroup: boolean) {
    if (isGroup) return message.reply(responseMsg, null, { linkPreview: false });
    else return getWhatsAppClient().sendMessage(message.from, responseMsg, { linkPreview: false });
  }
}

const whatsappMessageService = new WhatsAppMessageService();
export default whatsappMessageService;
