import { AIAnswer, AiMessage, AIProvider, OperationResult } from "../interfaces/ai-interfaces";
import { AIConfig, CONFIG } from "../config";
import WhatsAppMessageService from "./wsp-web";
import OpenAISvc from "../services/openai-service";
import logger from "../logger";
import {
  bufferToStream,
  extractAnswer,
  handleOpenAIError,
  includeName,
  parseCommand,
  parseIfJson,
  sleep
} from "../utils";
import { ChatConfiguration, chatConfigurationManager } from "../config/chat-configurations";
import { getTools } from "../config/functions";
import { convertIaMessagesLang } from "./message-conversion";
import CustomOpenAISvc from "../services/openai-custom-service";
import OpenaiCustomService from "../services/openai-custom-service";
import AnthropicSvc from "../services/anthropic-service";
import { CVoices, elevenTTS } from "../services/elevenlabs-service";
import Reminders from "../services/reminder-service";
import MemoryService from "../services/memory-service";
import LLMMessages from "../services/llm-cache";
import path from "node:path";
import fs from "node:fs";
import { requestAppRestart } from "../utils/restart";
import FluxSvc from "../services/flux-service";
import TavilySvc from "../services/tavily-service";
import { getWhatsAppClient } from "./whatsapp-client";
import { normalizeWAMessage } from "./baileys-message-normalizer";
import { WhatsAppMessage, normalizeComparableNumber, deserializeMessageId } from "./whatsapp-types";

class RobotoClass {

  private busyChats = new Set<string>();
  private chatImageRetry = new Map();
  private botEnabled = true;

  public async readWspMessage(wspMessage: WhatsAppMessage) {
    const chatId = wspMessage.chatId;
    const isGroup = chatId.endsWith('@g.us');

    try {
      const chatConfig = await chatConfigurationManager.getChatConfig(chatId, '');
      const botName = chatConfig.botName;
      const authorNumber = normalizeComparableNumber(wspMessage.authorId);
      const isAdmin = CONFIG.BotConfig.adminNumbers.includes(authorNumber);

      logger.info(`[ReceivedMessage] {msg:'${wspMessage.body}', author:${wspMessage.authorId}, isGroup:${isGroup}, chatId:${chatId}}`);

      if (this.isCommand(wspMessage, isAdmin)) return this.commandSelect(wspMessage, chatId, isAdmin, chatConfig);

      const shouldProcess = await this.shouldProcessMessage(wspMessage, isGroup, botName);
      if (!shouldProcess) return false;

      while (this.busyChats.has(chatId)) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      this.busyChats.add(chatId);
      this.sendStateTyping(chatId);

      const memoriesContext = await MemoryService.getMemoryContext(chatId, !isGroup ? wspMessage.authorId : null);
      const systemPrompt = CONFIG.getSystemPrompt(chatConfig, memoriesContext);

      const aiMessages: AiMessage[] = await WhatsAppMessageService.generateMessageArray(
        wspMessage,
        { id: { _serialized: chatId }, isGroup, name: chatConfig.name } as any,
        chatConfig,
        LLMMessages.hasChatCache(chatId)
      );
      const aiResponse = await this.sendMessageToAi(aiMessages, systemPrompt, chatConfig);

      let chatResponse: AIAnswer = extractAnswer(aiResponse, botName);
      if (!chatResponse || !chatResponse.message) return false;

      if (chatResponse.emojiReact)
        await getWhatsAppClient().react(wspMessage.id, chatResponse.emojiReact);

      return this.sendResponse(wspMessage, chatResponse.message, isGroup);

    } catch (e) {
      logger.error('[readWspMessage] ErrorMessage:' + e.message);
      logger.error('[readWspMessage] Chat context is being reset due to errors');
      LLMMessages.deleteChatCache(chatId);
      return requestAppRestart('Error en readWspMessage', e);
    } finally {
      this.busyChats.delete(chatId);
      await getWhatsAppClient().clearTyping(chatId);
    }
  }

  public async sendMessageToAi(aiMessages: AiMessage[], systemPrompt: any, chatConfig: ChatConfiguration, withTools = true) {
    const messagesList = convertIaMessagesLang(aiMessages) as any;
    const isGroup = chatConfig.chatId.endsWith('@g.us');
    const tools = withTools ? getTools({ isGroup }) : undefined;

    switch (AIConfig.ChatConfig.provider) {
      case AIProvider.OPENAI:
        return await OpenAISvc.sendMessage(messagesList, systemPrompt, chatConfig, tools);
      case AIProvider.CLAUDE:
        return await AnthropicSvc.sendMessage(messagesList, systemPrompt, chatConfig, tools);
      default:
        return await CustomOpenAISvc.sendMessage(messagesList, systemPrompt, chatConfig, tools);
    }
  }

  public async handleFunction(functionName: string, functionArgs: any): Promise<OperationResult> {
    try {
      const args = parseIfJson(functionArgs);
      logger.info(`[Assistant->handleFunction] Executing function: ${functionName} with args: ${JSON.stringify(args)}`);

      const handlers: Record<string, (args: any) => Promise<OperationResult>> = {
        generate_image: async (args: any) => {
          const imageRetryCount = this.chatImageRetry.get(args.chatId);
          try {
            await this.createImage(args);
            this.chatImageRetry.set(args.chatId, 0);
            return { success: true, result: 'The image has been generated and sent to the chat.' };
          } catch (e) {
            handleOpenAIError(e);
            if (imageRetryCount >= 3 || e.code == '400' || !e.message.toLowerCase().includes('safety system')) {
              this.chatImageRetry.set(args.chatId, 0);
              return { success: false, result: `Error generating image: ${e.message}.` };
            }
            this.chatImageRetry.set(args.chatId, imageRetryCount ? imageRetryCount + 1 : 1);
            const match = e.message.match(/safety_violations=\[([^\]]*)\]/);
            const safety_violations = match ? match[1] : null;
            return { success: false, result: `OpenAI's safety filters blocked the request (safety_violations:${safety_violations}). Please call generate_image again with a different phrasing. Rephrase the prompt to avoid sensitive content.` };
          }
        },
        generate_speech: async (args: any) => {
          const { input, instructions, msg_id, voice_gender } = args;
          await this.sendAudioResponse(msg_id, { instructions, messageToSay: input, voiceGender: voice_gender });
          return { success: true, result: 'The audio has been generated and sent to the user. You should respond with { "message" : null } to avoid duplicate messages' };
        },
        reminder_manager: async (args) => {
          return await Reminders.processFunctionCall(args);
        },
        user_memory_manager: async (args) => {
          return await MemoryService.processFunctionCall(args);
        },
        group_memory_manager: async (args) => {
          return await MemoryService.processFunctionCall(args);
        },
        web_search: async (args) => {
          return await TavilySvc.search(args);
        }
      };
      return await handlers[functionName](args);

    } catch (e) {
      logger.error(e.message);
      return { success: false, result: `Error executing function ${functionName}: ${e.message}` };
    }
  }

  private async shouldProcessMessage(wspMessage: WhatsAppMessage, isGroup: boolean, botName: string) {
    if (!this.botEnabled) return false;
    if (wspMessage.fromMe) return false;

    const authorNumber = normalizeComparableNumber(wspMessage.authorId);

    if (process.env.DEBUG == "1") {
      if (!CONFIG.BotConfig.adminNumbers.includes(authorNumber)) return false;
    }
    if (CONFIG.BotConfig.restrictedNumbers.includes(authorNumber)) {
      logger.debug(`Number ${authorNumber} is in the restricted list. Message ignored`);
      return false;
    }

    const isSelfMention = wspMessage.quotedMsgId
      ? (deserializeMessageId(wspMessage.quotedMsgId)?.fromMe === true)
      : false;
    const isMentioned = includeName(wspMessage.body, botName)
      || (wspMessage.mentionedJids?.some(jid => {
        const botJid = getWhatsAppClient().getBotJid();
        return botJid ? jid === botJid : false;
      }) ?? false);

    if (!isSelfMention && !isMentioned && isGroup) return false;

    const isOldMessage = wspMessage.timestamp * 1000 < (Date.now() - 10 * 60000);
    return !isOldMessage;
  }

  private async commandSelect(message: WhatsAppMessage, chatId: string, isAdmin = false, chatConfig?: ChatConfiguration) {
    const { command, commandMessage } = parseCommand(message.body);

    if (!isAdmin && !this.botEnabled) return false;

    switch (command) {
      case "chatconfig":
        return await this.handleChatConfigCommand(message, commandMessage!, chatConfig);
      case "reset":
        LLMMessages.deleteChatCache(chatId);
        return true;
      case "memory":
        return await this.handleMemoryCommand(message, commandMessage!, chatConfig);
      case "enable":
        if (!isAdmin) return false;
        this.botEnabled = true;
        return getWhatsAppClient().reply(message.id, 'Bot enabled.');
      case "disable":
        if (!isAdmin) return false;
        this.botEnabled = false;
        return getWhatsAppClient().reply(message.id, 'Bot disabled. No message will be answered');
      default:
        return true;
    }
  }

  private isCommand(wspMessage: WhatsAppMessage, isAdmin = false) {
    const commands = ['-chatconfig', '-reset'];
    if (CONFIG.BotConfig.memoriesEnabled) commands.push('-memory');
    if (isAdmin) commands.push('-enable', '-disable');
    return commands.includes(wspMessage.body.split(' ')[0]);
  }

  private async createImage(args: {
    prompt: string,
    msg_id: string,
    chatId: string,
    background: string,
    image_msg_ids: string[],
    output_format: "png" | "jpg" | "webp",
    send_as: "image" | "sticker",
    size: any
  }) {
    const wspClient = getWhatsAppClient();
    const wspMsg = await wspClient.getMessageById(args.msg_id);
    let imageStreams = null;
    let images;

    if (args.image_msg_ids?.length > 0) {
      imageStreams = await Promise.all(
        args.image_msg_ids.map(async (imgMsgId: string) => {
          logger.debug(`[createImage] imgMsgId=${imgMsgId}`);

          if (imgMsgId.startsWith("LOCAL-")) {
            const filename = imgMsgId.replace("LOCAL-", "") + ".jpg";
            const filePath = path.join(__dirname, '/../../assets/images/', filename);
            logger.debug(`[createImage] filePath=${filePath}`);
            if (!fs.existsSync(filePath)) throw new Error(`No se encontró ningún archivo local con filename=${filename}`);
            return fs.createReadStream(filePath);
          }

          let imgMsg = await wspClient.getMessageById(imgMsgId);
          if (!imgMsg) {
            await sleep(3000);
            imgMsg = await wspClient.getMessageById(imgMsgId);
          }

          logger.debug(`[createImage] imgMsg=${imgMsg} imgMsg.id=${imgMsg?.id}`);

          const media = await WhatsAppMessageService.extractMedia(imgMsg);
          if (media.errorMedia) throw new Error(media.errorMedia);

          const buffer = Buffer.from(media.mediaData.data, 'base64');
          return bufferToStream(buffer);
        })
      );
    }

    if (AIConfig.ImageConfig.provider == AIProvider.OPENAI) {
      images = await OpenAISvc.generateImage({
        prompt: args.prompt,
        imageStreams: imageStreams,
        background: args.background as any,
        output_format: args.output_format,
        quality: 'auto',
        size: args.size
      });
    } else if (AIConfig.ImageConfig.provider == AIProvider.FLUX) {
      images = await FluxSvc.generateImage({
        prompt: args.prompt,
        imageStreams: imageStreams ?? undefined,
        output_format: args.output_format == 'jpg' ? 'jpeg' : 'png',
        size: args.size
      });
    } else {
      images = await OpenaiCustomService.generateImage(args.prompt);
    }

    const media = {
      mimetype: `image/${args.output_format === 'jpg' ? 'jpeg' : args.output_format}`,
      data: images[0].b64_json,
      filename: `image.${args.output_format}`,
    };
    const isSticker = args.send_as == 'sticker' || wspMsg?.body.toLowerCase().includes('sticker');
    const sent = await getWhatsAppClient().sendMessage(args.chatId, media, { asSticker: isSticker });

    return await this.addMessageToCache(sent, args.chatId);
  }

  private async sendAudioResponse(msg_id: string, params: { messageToSay: string, instructions?: string, responseFormat?: string, voiceGender?: string }): Promise<void> {
    try {
      let base64Audio;
      const wspMsg = await getWhatsAppClient().getMessageById(msg_id);

      if (AIConfig.SpeechConfig.provider == AIProvider.ELEVENLABS) {
        const voice = params.voiceGender == 'male' ? CVoices.GEORGE : CVoices.SARAH;
        base64Audio = await elevenTTS(params.messageToSay, voice);
      } else {
        const voice = params.voiceGender == 'male' ? 'ash' : 'nova';
        const audioBuffer = await OpenAISvc.speech(params.messageToSay, params.responseFormat, voice, params.instructions);
        base64Audio = audioBuffer.toString('base64');
      }

      const audioMedia = { mimetype: 'audio/mp3', data: base64Audio, filename: 'voice.mp3' };
      await getWhatsAppClient().reply(wspMsg, audioMedia, { asVoice: true });

    } catch (e: any) {
      logger.error(`Error in speak function: ${e.message}`);
      throw e;
    }
  }

  private async handleChatConfigCommand(message: WhatsAppMessage, commandText: string, chatConfig?: ChatConfiguration) {
    const chatId = message.chatId;
    const isGroup = chatId.endsWith('@g.us');
    const client = getWhatsAppClient();

    if (isGroup) {
      const chat = await client.getChatById(chatId);
      const participant = chat.participants.find(p => p.id._serialized === message.authorId);
      const isAdmin = participant?.isAdmin || participant?.isSuperAdmin;
      if (!isAdmin) {
        return client.reply(message.id, "Only group administrators can change the bot's configuration in groups.");
      }
    }

    const chatName = chatConfig?.name ?? '';
    const parts = commandText.split(' ');
    const subCommand = parts[0].toLowerCase();

    switch (subCommand) {
      case 'prompt':
      case 'botname': {
        const value = parts.slice(1).join(' ');
        if (!value) return client.reply(message.id, `Please provide a ${subCommand === 'prompt' ? 'prompt description' : 'name for the bot'}.`);

        const existingConfig = await chatConfigurationManager.getChatConfig(chatId, chatName);
        const updateOptions: any = {
          promptInfo: existingConfig?.promptInfo || CONFIG.BotConfig.promptInfo,
          botName: existingConfig?.botName
        };

        if (subCommand === 'prompt') updateOptions.promptInfo = value;
        else updateOptions.botName = value;

        const updatedConfig = await chatConfigurationManager.updateChatConfig(chatId, chatName, isGroup, updateOptions);

        return client.reply(message.id,
          subCommand === 'prompt'
            ? `✅ Updated prompt for this ${isGroup ? 'group' : 'chat'}. The bot now: ${updatedConfig.promptInfo}`
            : `✅ Bot name for this ${isGroup ? 'group' : 'chat'} has been set to: ${updatedConfig.botName}`
        );
      }

      case 'remove': {
        const removed = chatConfigurationManager.removeChatConfig(chatId);
        return client.reply(message.id,
          removed
            ? `✅ The custom prompt and bot name have been removed. The bot will use the default configuration.`
            : `This ${isGroup ? 'group' : 'chat'} did not have a custom configuration.`
        );
      }

      case 'show': {
        const currentConfig = await chatConfigurationManager.getChatConfig(chatId, chatName);
        if (!currentConfig) return client.reply(message.id, `This ${isGroup ? 'group' : 'chat'} does not have a custom configuration.`);

        let response = currentConfig.promptInfo ? `Current personality: ${currentConfig.promptInfo}` : ``;
        if (currentConfig.botName) response += `\nBot name: ${currentConfig.botName ?? CONFIG.BotConfig.botName}`;

        return client.reply(message.id, response);
      }

      default:
        return client.reply(message.id,
          "Available commands:\n" +
          `- *-chatconfig prompt [description]*: Sets the bot's personality for this ${isGroup ? 'group' : 'chat'}\n` +
          `- *-chatconfig botname [name]*: Sets the bot's name for this ${isGroup ? 'group' : 'chat'}\n` +
          "- *-chatconfig remove*: Removes the custom configuration\n" +
          "- *-chatconfig show*: Displays the current configuration"
        );
    }
  }

  private async handleMemoryCommand(message: WhatsAppMessage, commandText: string, chatConfig?: ChatConfiguration) {
    const chatId = message.chatId;
    const isGroup = chatId.endsWith('@g.us');
    const authorId = message.authorId;
    const chatName = chatConfig?.name ?? chatId;
    const client = getWhatsAppClient();

    const parts = commandText.split(' ');
    const subCommand = parts[0]?.toLowerCase();

    switch (subCommand) {
      case 'show': {
        const memory = await MemoryService.getMemory(chatId, authorId);
        if (!memory) {
          return client.reply(message.id, "I don't have any information saved about you.");
        }

        let response = `📋 *Information I have saved about you:*\n`;
        if (memory.real_name) response += `👤 Real name: ${memory.real_name}\n`;
        if (memory.age) response += `👤 Age: ${memory.age}\n`;
        if (memory.profession) response += `💼 Profession: ${memory.profession}\n`;
        if (memory.location) response += `📍 Location: ${memory.location}\n`;
        if (memory.interests?.length) response += `🎯 Interests: ${memory.interests.join(', ')}\n`;
        if (memory.likes?.length) response += `👍 Likes: ${memory.likes.join(', ')}\n`;
        if (memory.dislikes?.length) response += `👎 Dislikes: ${memory.dislikes.join(', ')}\n`;
        if (memory.running_jokes?.length) response += `😄 Running jokes: ${memory.running_jokes.join(', ')}\n`;
        if (memory.nicknames?.length) response += `🏷️ Nicknames: ${memory.nicknames.join(', ')}\n`;
        if (memory.notes?.length) response += `📝 Notes: ${memory.notes.join(', ')}\n`;

        return client.reply(message.id, response);
      }

      case 'group': {
        if (!isGroup) {
          return client.reply(message.id, "This command is only available in group chats.");
        }

        const groupMemory = await MemoryService.getMemory(chatId);
        if (!groupMemory) {
          return client.reply(message.id, "I don't have any group information saved yet.");
        }

        let groupResponse = `📋 *Group Memory for ${chatName}:*\n`;
        if (groupMemory.group_interests?.length) groupResponse += `🎯 Group interests: ${groupMemory.group_interests.join(', ')}\n`;
        if (groupMemory.recurring_topics?.length) groupResponse += `💬 Recurring topics: ${groupMemory.recurring_topics.join(', ')}\n`;
        if (groupMemory.group_likes?.length) groupResponse += `👍 Group likes: ${groupMemory.group_likes.join(', ')}\n`;
        if (groupMemory.group_dislikes?.length) groupResponse += `👎 Group dislikes: ${groupMemory.group_dislikes.join(', ')}\n`;
        if (groupMemory.group_running_jokes?.length) groupResponse += `😄 Group jokes: ${groupMemory.group_running_jokes.join(', ')}\n`;
        if (groupMemory.group_notes?.length) groupResponse += `📝 Group notes: ${groupMemory.group_notes.join(', ')}\n`;
        if (groupMemory.group_jargon && Object.keys(groupMemory.group_jargon).length > 0) {
          const jargonText = Object.entries(groupMemory.group_jargon).map(([term, meaning]) => `${term}: ${meaning}`).join(', ');
          groupResponse += `🗣️ Group jargon: ${jargonText}\n`;
        }

        return client.reply(message.id, groupResponse);
      }

      case 'clear': {
        await MemoryService.processFunctionCall({
          action: 'clear',
          chat_id: chatId,
          author_id: authorId
        });
        return client.reply(message.id, "✅ Your personal information has been removed from my memory.");
      }

      case 'cleargroup': {
        if (!isGroup) {
          return client.reply(message.id, "This command is only available in group chats.");
        }

        await MemoryService.processFunctionCall({
          action: 'delete',
          chat_id: chatId
        });
        return client.reply(message.id, "✅ Group memory has been cleared.");
      }

      default: {
        const commands = [
          "Available memory commands:",
          "• *-memory show*: Shows your personal information",
          "• *-memory clear*: Clears your personal information"
        ];

        if (isGroup) {
          commands.push("• *-memory group*: Shows group memory");
          commands.push("• *-memory cleargroup*: Clears group memory");
        }

        return client.reply(message.id, commands.join('\n'));
      }
    }
  }

  private async addMessageToCache(wspMessage: any, chatId: string) {
    try {
      const aiMessage = await WhatsAppMessageService.convertWspMsgToAiMsg(wspMessage);
      const items = convertIaMessagesLang([aiMessage]) as any;
      return LLMMessages.getMessages(chatId).push(items[0]);
    } catch (e) {
      logger.error(`Error adding message to cache: ${e}`);
    }
  }

  private sendStateTyping(chatId: string) {
    const client = getWhatsAppClient();
    void (async () => {
      while (this.busyChats.has(chatId)) {
        await client.sendTyping(chatId);
        await sleep(2000);
      }
    })();
  }

  private sendResponse(message: WhatsAppMessage, responseMsg: string, isGroup: boolean) {
    const client = getWhatsAppClient();
    if (isGroup) return client.reply(message.id, responseMsg, { linkPreview: false });
    else return client.sendMessage(message.chatId, responseMsg, { linkPreview: false });
  }

}

const Roboto = new RobotoClass();
export default Roboto;
