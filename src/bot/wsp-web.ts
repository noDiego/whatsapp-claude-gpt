import { Chat, Client, Message, MessageMedia, MessageTypes } from "whatsapp-web.js";
import { AIContent, AiMessage, AIRole } from "../interfaces/ai-interfaces";
import { bufferToStream, getAuthorId, getFormattedDate, getUnsupportedMessage, removeNonAlphanumeric } from "../utils";
import logger from "../logger";
import NodeCache from "node-cache";
import OpenAISvc from "../services/openai-service";
import { CONFIG } from "../config";
import { Array } from "openai/internal/builtin-types";
import { ChatConfiguration, chatConfigurationManager } from "../config/chat-configurations";

class WspWeb {
  private msgMediaCache: NodeCache = new NodeCache();
  private transcribedMessagesCache: NodeCache = new NodeCache();
  private wspClient: Client;
  private lastProcessed = new Map();

  constructor() {
  }

  public async generateMessageArray(wspMessage: Message, chatData: Chat, chatCfg: ChatConfiguration): Promise<AiMessage[]> {

    const messageList: AiMessage[] = [];
    const lastChatMsgProcessed = this.lastProcessed.get(chatData.id._serialized);

    const fetchedMessages = await chatData.fetchMessages({limit: chatCfg.maxMsgsLimit});

    const resetIndex = fetchedMessages.map(msg => msg.body).lastIndexOf("-reset");
    const messagesToProcess = resetIndex >= 0 ? fetchedMessages.slice(resetIndex + 1) : fetchedMessages;

    const wspMessageIndex = messagesToProcess.findIndex(msg => msg.id._serialized === wspMessage.id._serialized);
    const startIndex = wspMessageIndex !== -1 ? wspMessageIndex : 0;
    const messagesToProcessFiltered = messagesToProcess.slice(0, startIndex + 1);

    for (const msg of messagesToProcessFiltered.reverse()) {
      try {
        const actualDate = new Date();
        const msgDate = new Date(msg.timestamp * 1000);

        if ((actualDate.getTime() - msgDate.getTime()) / (1000 * 60 * 60) > chatCfg.maxHoursLimit) break;
        if (wspMessage.timestamp < msg.timestamp) continue;
        if (msg.fromMe || lastChatMsgProcessed == msg.id._serialized ) break;

        const aiMessage = await this.convertWspMsgToAiMsg(msg, chatCfg.botName);

        messageList.push(aiMessage);
      } catch (e: any) {
        logger.error(`Error reading message - msg.type:${msg.type}; msg.body:${msg.body}. Error:${e.message}`);
      }
    }

    this.lastProcessed.set(chatData.id._serialized, wspMessage.id._serialized);
    return messageList.reverse() || [];
  }

  async extractMedia(wspMsg: Message): Promise<{errorMedia: string, mediaData: MessageMedia}> {

    const mediaData: MessageMedia = this.msgMediaCache.get<MessageMedia>(wspMsg.id._serialized) ?? await wspMsg.downloadMedia();
    const isImage = wspMsg.type === MessageTypes.IMAGE || wspMsg.type === MessageTypes.STICKER

    if (mediaData) {
      if(!mediaData.mimetype.startsWith('image') && mediaData.mimetype != 'application/pdf')
          return { errorMedia: 'type', mediaData: null};

      const sizeInMB = Buffer.from(mediaData.data, 'base64').length / (1024 * 1024);
      const maxMB = isImage
          ? CONFIG.BotConfig.maxImageSizeMB
          : CONFIG.BotConfig.maxDocumentSizeMB;

      if (sizeInMB > maxMB) {
        logger.warn(`Rejected file: ${sizeInMB.toFixed(2)}MB (limit: ${maxMB}MB)`);
        return { errorMedia: 'size', mediaData: null};
      }
      this.msgMediaCache.set(wspMsg.id._serialized, mediaData, CONFIG.BotConfig.nodeCacheTime);
      return { errorMedia:null, mediaData };
    }
    return { errorMedia:null, mediaData: null };
  }

  public async convertWspMsgToAiMsg(wspMsg: Message, inputBotName?: string): Promise<AiMessage> {
    let mediaData: MessageMedia = this.msgMediaCache.get<any>(wspMsg.id._serialized);
    let errorMedia = null;
    const chat = await wspMsg.getChat();
    const msgDate = new Date(wspMsg.timestamp * 1000);
    const author_id = getAuthorId(wspMsg);
    const botName = inputBotName ?? (await chatConfigurationManager.getChatConfig(chat.id._serialized, chat.name)).botName;

    const isImage = wspMsg.type === MessageTypes.IMAGE || wspMsg.type === MessageTypes.STICKER;
    const isAudio = wspMsg.type === MessageTypes.VOICE || wspMsg.type === MessageTypes.AUDIO;
    const isDocument = wspMsg.type === MessageTypes.DOCUMENT;

    if (!mediaData && (isImage || isDocument)) {
      ({mediaData, errorMedia} = await this.extractMedia(wspMsg));
    }

    const isOther = (!isImage && !isAudio && wspMsg.type != 'chat') || errorMedia == 'type';

    const role = (!wspMsg.fromMe || isImage) ? AIRole.USER : AIRole.ASSISTANT;
    const name = wspMsg.fromMe ? botName : (await this.getContactName(wspMsg));

    const content: Array<AIContent> = [];

    if (isImage) {
      if (mediaData) {
        content.push({
          type: 'image',
          value: mediaData.data,
          mimetype: mediaData.mimetype,
          msg_id: wspMsg.id._serialized,
          author_id,
          dateString: getFormattedDate(msgDate)
        });
      } else {
        content.push({
          type: 'text',
          msg_id: wspMsg.id._serialized,
          value: '<Unprocessed image>',
          author_id,
          dateString: getFormattedDate(msgDate)
        });
      }
    }

    if (isAudio) {
        content.push({
          type: 'ASR',
          msg_id: wspMsg.id._serialized,
          value: await this.transcribeVoice(wspMsg),
          author_id,
          dateString: getFormattedDate(msgDate)
        });
    }

    if (isDocument) {
      content.push({
        type: 'file',
        msg_id: wspMsg.id._serialized,
        mimetype: mediaData.mimetype,
        filename: mediaData.filename,
        value: mediaData.data,
        author_id,
        dateString: getFormattedDate(msgDate)
      });
    }

    if (errorMedia || (isOther && !mediaData)){
      let errorMessage = getUnsupportedMessage(wspMsg.type, wspMsg.body);
      if(errorMedia == 'size') errorMessage = `SYSTEM:⚠️ The file could not be processed because it exceeds the maximum allowed size (${isImage?CONFIG.BotConfig.maxImageSizeMB:CONFIG.BotConfig.maxDocumentSizeMB}MB).`
      content.push({
        type: 'text',
        msg_id: wspMsg.id._serialized,
        value: errorMessage,
        author_id,
        dateString: getFormattedDate(new Date(wspMsg.timestamp * 1000))
      });
    }

    if (wspMsg.body && !isOther) {
      content.push({
        type: 'text',
        msg_id: wspMsg.id._serialized,
        value: wspMsg.body,
        author_id,
        dateString: getFormattedDate(msgDate)
      });
    }

    return {role: role, name: name, content: content};
  }

  /**
   * Transcribes a voice message to text, using cache when possible.
   *
   * - Checks NodeCache for existing transcription.
   * - Converts base64 media to a stream.
   * - Sends to the configured transcription service (e.g. Whisper).
   * - Caches the resulting text for future reuse.
   *
   * @returns         Promise<string> the transcribed text or error placeholder.
   * @param wspMsg
   */
  private async transcribeVoice(wspMsg: Message): Promise<string> {
    try {

      let transcribedText = this.transcribedMessagesCache.get<string>(wspMsg.id._serialized);
      if(transcribedText) return transcribedText;

      const media = await wspMsg.downloadMedia();
      const audioBuffer = Buffer.from(media.data, 'base64');
      const audioStream = bufferToStream(audioBuffer);

      logger.debug(`[OpenAI->transcribeVoice] Starting audio transcription`);
      transcribedText = await OpenAISvc.transcription(audioStream);
      logger.debug(`[OpenAI->transcribeVoice] Transcribed text: ${transcribedText}`);

      this.transcribedMessagesCache.set<string>(wspMsg.id._serialized,transcribedText, CONFIG.BotConfig.nodeCacheTime);

      return transcribedText;
    } catch (error: any) {
      logger.error(`Error transcribing voice message: ${error.message}`);
      return '<Error transcribing voice message>';
    }
  }

  private async getContactName(wspMessage: Message) {
    const contactInfo = await wspMessage.getContact();
    const name = contactInfo.pushname || contactInfo.shortName || contactInfo.name || contactInfo.number;
    return removeNonAlphanumeric(name);
  }

  public returnResponse(message: Message, responseMsg: string, isGroup: boolean) {
    if (isGroup) return message.reply(responseMsg, null, {linkPreview: false});
    else return this.wspClient.sendMessage(message.from, responseMsg, {linkPreview: false});
  }

  public setWspClient(client) {
    this.wspClient = client;
  }

  public getWspClient(): Client {
    return this.wspClient;
  }

}

const WhatsappHandler = new WspWeb();
export default WhatsappHandler;