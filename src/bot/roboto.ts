import { Chat, GroupChat, Message, MessageMedia } from "whatsapp-web.js";
import { AIAnswer, AiMessage, AIProvider, OperationResult } from "../interfaces/ai-interfaces";
import { AIConfig, CONFIG } from "../config";
import WspWeb from "./wsp-web";
import OpenAISvc from "../services/openai-service";
import logger from "../logger";
import {
  bufferToStream,
  extractAnswer,
  getAuthorId,
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
import wspWeb from "./wsp-web";
import LLMMessages from "../services/llm-cache";
import path from "node:path";
import fs from "node:fs";
import { requestAppRestart } from "../utils/restart";

class RobotoClass {

  private busyChats = new Set<string>();
  private chatImageRetry = new Map();
  private botEnabled = true;

  constructor() {
  }

  public async readWspMessage(wspMessage: Message) {
    const chatData: Chat = await wspMessage.getChat();
    const chatId = chatData.id._serialized;

    try {

      const contactData = await wspMessage.getContact();
      const chatConfig = await chatConfigurationManager.getChatConfig(chatData.id._serialized, chatData.name);
      const botName = chatConfig.botName;
      const isAdmin = CONFIG.BotConfig.adminNumbers.includes(contactData.number);

      if (this.isCommand(wspMessage, isAdmin)) return this.commandSelect(wspMessage, chatId, isAdmin);

      const shouldProcess = await this.shouldProcessMessage(wspMessage, chatData, botName);
      if (!shouldProcess) return false;

      while (this.busyChats.has(chatId)) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      this.busyChats.add(chatId);
      this.sendStateTyping(chatData);

      const memoriesContext = await MemoryService.getMemoryContext(chatId, !chatData.isGroup? getAuthorId(wspMessage): null);
      const systemPrompt = CONFIG.getSystemPrompt(chatConfig, memoriesContext);

      const aiMessages: AiMessage[] = await WspWeb.generateMessageArray(wspMessage, chatData, chatConfig, LLMMessages.hasChatCache(chatId));
      const aiResponse = await this.sendMessageToAi(aiMessages, systemPrompt, chatConfig);

      let chatResponse: AIAnswer = extractAnswer(aiResponse, botName);
      if (!chatResponse || !chatResponse.message) return false;

      // If the response includes emoji reaction, react to the message
      if (chatResponse.emojiReact)
        wspMessage.react(chatResponse.emojiReact);

      return WspWeb.returnResponse(wspMessage, chatResponse.message, chatData.isGroup);

    } catch (e) {
      logger.error('[readWspMessage] ErrorMessage:' + e.message);
      logger.error('[readWspMessage] Chat context is being reset due to errors');
      LLMMessages.deleteChatCache(chatId);
      return requestAppRestart('Error en readWspMessage', e);
    } finally {
      this.busyChats.delete(chatId);
      chatData.clearState();
    }

  }

  public async sendMessageToAi(aiMessages: AiMessage[], systemPrompt, chatConfig: ChatConfiguration, withTools = true){
    const messagesList = convertIaMessagesLang(aiMessages) as any;
    const chat = await wspWeb.getWspClient().getChatById(chatConfig.chatId);
    const tools = withTools ? getTools(chat) : undefined;

    switch (AIConfig.ChatConfig.provider){
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
            return { success: true, result: 'The image has been generated and sent to the chat.'};
          } catch (e){
            handleOpenAIError(e);
            if (imageRetryCount >= 3 || e.code == '400' || !e.message.toLowerCase().includes('safety system')) {
              this.chatImageRetry.set(args.chatId, 0);
              return {success: false, result: `Error generating image: ${e.message}.`};
            }
            this.chatImageRetry.set(args.chatId, imageRetryCount ? imageRetryCount + 1 : 1);
            const match = e.message.match(/safety_violations=\[([^\]]*)\]/);
            const safety_violations = match ? match[1] : null;
            return { success: false, result: `OpenAI's safety filters blocked the request (safety_violations:${safety_violations}). Please call generate_image again with a different phrasing. Rephrase the prompt to avoid sensitive content.`};
          }
        },
        generate_speech: async (args: any) => {
          const {input, instructions, msg_id, voice_gender} = args;
          await this.sendAudioResponse(msg_id, {instructions, messageToSay: input, voiceGender: voice_gender});
          return {success: true, result: 'The audio has been generated and sent to the user. You should respond with { "message" : null } to avoid duplicate messages'};
        },
        reminder_manager: async (args) => {
          return await Reminders.processFunctionCall(args);
        },
        user_memory_manager: async (args) => {
          return await MemoryService.processFunctionCall(args);
        },
        group_memory_manager: async (args) => {
          return await MemoryService.processFunctionCall(args);
        }
      };
      return await handlers[functionName](args);

    } catch (e) {
      logger.error(e.message);
      return {success: false, result: `Error executing function ${functionName}: ${e.message}`};
    }

  }

  private async shouldProcessMessage(wspMessage: Message, chatData: Chat, botName: string){

    if(!this.botEnabled) return false;

    if(wspMessage.fromMe || getAuthorId(wspMessage).includes("0@c.us")) return false;

    const contactData = await wspMessage.getContact();

    if(process.env.DEBUG == "1") {
      if (!CONFIG.BotConfig.adminNumbers.includes(contactData.number)) return false;
    }
    if(CONFIG.BotConfig.restrictedNumbers.includes(contactData.number)){
      logger.debug(`Number ${contactData.number} is in the restricted list. Message ignored`);
      return false;
    }

    const isSelfMention = wspMessage.hasQuotedMsg ? (await wspMessage.getQuotedMessage()).fromMe : false;
    const isMentioned = includeName(wspMessage.body, botName);

    if (!isSelfMention && !isMentioned && chatData.isGroup) return false;

    const isOldMessage = wspMessage.timestamp * 1000 < (Date.now() - 10 * 60000);
    return !isOldMessage;
  }

  /**
   * Selects and executes an action based on the command in the message.
   *
   * This function acts as a command dispatcher that interprets commands prefixed with "-"
   * and routes them to the appropriate handler methods. Currently supports:
   *
   * - "-image [prompt]": Generates images using AI (if enabled in config)
   * - "-chatconfig [subcommand]": Manages chat-specific configurations
   * - "-reset": Resets the conversation context with the AI
   *
   * The function parses the command and its arguments from the message body
   * and executes the corresponding functionality.
   *
   * @param message - The Message object containing the command
   * @param chatId
   * @param isAdmin
   * @returns A promise resolving when the command processing is complete
   */
  private async commandSelect(message: Message, chatId: string, isAdmin = false) {
    const {command, commandMessage} = parseCommand(message.body);

    if(!isAdmin && !this.botEnabled) return false;

    switch (command) {
      case "chatconfig":
        return await this.handleChatConfigCommand(message, commandMessage!);
      case "reset":
        LLMMessages.deleteChatCache(chatId);
        return await message.react('👍');
      case "memory":
        return await this.handleMemoryCommand(message, commandMessage!);
      case "enable":
        if(!isAdmin) return false;
        this.botEnabled = true;
        return message.reply('Bot enabled.')
      case "disable":
        if(!isAdmin) return false;
        this.botEnabled = false;
        return message.reply('Bot disabled. No message will be answered')
      default:
        return true;
    }
  }

  private isCommand(wspMessage: Message, isAdmin: boolean = false){
    const commands = ['-chatconfig', '-reset'];
    if(CONFIG.BotConfig.memoriesEnabled) commands.push('-memory');
    if(isAdmin) commands.push('-enable','-disable');
    return commands.includes(wspMessage.body.split(' ')[0]);
  }

  /**
     * Creates and sends an AI-generated image in response to a text prompt.
     *
     * This function uses OpenAI's DALL-E model to generate an image based on
     * the provided text prompt. The resulting image is sent as a reply to the
     * original message.
     *
     * @returns A promise that resolves when the image is sent
     * @param args
     */
  private async createImage(args: {
    prompt: string,
    msg_id: string,
    chatId: string,
    background: string,
    image_msg_ids: string[],
    output_format: "png" | "jpg" | "webp",
    send_as: "image"| "sticker",
    size: any
  }) {

    const wspClient = WspWeb.getWspClient();
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
            if(!imgMsg){
              await sleep(3000);
              imgMsg = await wspClient.getMessageById(imgMsgId);
            }

            logger.debug(`[createImage] imgMsg=${imgMsg} imgMsg.id=${imgMsg?.id}`);

            const media = await WspWeb.extractMedia(imgMsg);
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
    } else {
      images = await OpenaiCustomService.generateImage(args.prompt);
    }

    const media = new MessageMedia(`image/${args.output_format=='jpg'?'jpeg':args.output_format}`, images[0].b64_json, `image.${args.output_format}`);
    let message;
    // if(wspMsg) message = await wspMsg.reply(media, args.chatId, {sendMediaAsSticker: args.send_as == 'sticker'});
    // else message = await WspWeb.getWspClient().sendMessage(args.chatId, media, {sendMediaAsSticker: args.send_as == 'sticker'});
    const isSticker = args.send_as == 'sticker' || wspMsg?.body.toLowerCase().includes('sticker');
    message = await WspWeb.getWspClient().sendMessage(args.chatId, media, {sendMediaAsSticker: isSticker});

    return await this.addMessageToCache(message, args.chatId);
  }

  private async sendAudioResponse(msg_id: string, params: {messageToSay: string, instructions?: string, responseFormat?: string, voiceGender?: string}): Promise<void> {

    try {
      let base64Audio;
      const wspMsg = await WspWeb.getWspClient().getMessageById(msg_id);

      if (AIConfig.SpeechConfig.provider == AIProvider.ELEVENLABS) {
        const voice = params.voiceGender == 'male'? CVoices.GEORGE : CVoices.SARAH;
        base64Audio = await elevenTTS(params.messageToSay, voice);
      } else {
        const voice = params.voiceGender == 'male'? 'ash' : 'nova';
        const audioBuffer = await OpenAISvc.speech(params.messageToSay, params.responseFormat, voice, params.instructions);
        base64Audio = audioBuffer.toString('base64');
      }

      let audioMedia = new MessageMedia('audio/mp3', base64Audio, 'voice.mp3');

      // Reply to the message with the synthesized speech audio.
      await wspMsg.reply(audioMedia, undefined, {sendAudioAsVoice: true});

    } catch (e: any) {
      logger.error(`Error in speak function: ${e.message}`);
      throw e;
    }
  }

  /**
   * Handles chat configuration commands for customizing bot behavior per chat.
   *
   * This function manages the following subcommands:
   * - prompt: Sets a custom personality/behavior for the bot in the current chat
   * - botname: Changes the bot's name for the current chat
   * - remove: Removes custom configurations and reverts to defaults
   * - show: Displays current custom configuration
   *
   * In group chats, only administrators can modify configurations.
   *
   * @param message - The Message object containing the command
   * @param commandText - The text of the command without the prefix
   * @returns A promise resolving to the sent reply message
   */
  private async handleChatConfigCommand(message: Message, commandText: string) {
    const chat = await message.getChat();
    const isGroup = chat.isGroup;

    if (isGroup) {
      const groupChat = chat as GroupChat;
      const participant = await groupChat.participants.find(p => p.id._serialized === message.author);
      const isAdmin = participant?.isAdmin || participant?.isSuperAdmin;
      if (!isAdmin) {
        return message.reply("Only group administrators can change the bot's configuration in groups.");
      }
    }

    const parts = commandText.split(' ');
    const subCommand = parts[0].toLowerCase();

    switch (subCommand) {
      case 'prompt':
      case 'botname':
        const value = parts.slice(1).join(' ');
        if (!value) return message.reply(`Please provide a ${subCommand === 'prompt' ? 'prompt description' : 'name for the bot'}.`);

        const existingConfig = await chatConfigurationManager.getChatConfig(chat.id._serialized, chat.name);

        const updateOptions: any = {
          promptInfo: existingConfig?.promptInfo || CONFIG.BotConfig.promptInfo,
          botName: existingConfig?.botName
        };

        if (subCommand === 'prompt') updateOptions.promptInfo = value;
        else updateOptions.botName = value;

        const updatedConfig = await chatConfigurationManager.updateChatConfig(
            chat.id._serialized,
            chat.name,
            isGroup,
            updateOptions
        );

        return message.reply(
            subCommand === 'prompt'
                ? `✅ Updated prompt for this ${isGroup ? 'group' : 'chat'}. The bot now: ${updatedConfig.promptInfo}`
                : `✅ Bot name for this ${isGroup ? 'group' : 'chat'} has been set to: ${updatedConfig.botName}`
        );

      case 'remove':
        const removed = chatConfigurationManager.removeChatConfig(chat.id._serialized);
        return message.reply(
            removed
                ? `✅ The custom prompt and bot name have been removed. The bot will use the default configuration.`
                : `This ${isGroup ? 'group' : 'chat'} did not have a custom configuration.`
        );

      case 'show':
        const currentConfig = await chatConfigurationManager.getChatConfig(chat.id._serialized, chat.name);
        if (!currentConfig) return message.reply(`This ${isGroup ? 'group' : 'chat'} does not have a custom configuration.`);

        let response = currentConfig.promptInfo? `Current personality: ${currentConfig.promptInfo}`:``;
        if (currentConfig.botName) response += `\nBot name: ${currentConfig.botName ?? CONFIG.BotConfig.botName}`;

        return message.reply(response);

      default:
        return message.reply(
            "Available commands:\n" +
            `- *-chatconfig prompt [description]*: Sets the bot's personality for this ${isGroup ? 'group' : 'chat'}\n` +
            `- *-chatconfig botname [name]*: Sets the bot's name for this ${isGroup ? 'group' : 'chat'}\n` +
            "- *-chatconfig remove*: Removes the custom configuration\n" +
            "- *-chatconfig show*: Displays the current configuration"
        );
    }
  }

  private async handleMemoryCommand(message: Message, commandText: string) {
    const chat = await message.getChat();
    const authorId = getAuthorId(message);

    const parts = commandText.split(' ');
    const subCommand = parts[0]?.toLowerCase();

    switch (subCommand) {
      case 'show':
        const memory = await MemoryService.getMemory(chat.id._serialized, authorId);
        if (!memory) {
          return message.reply("I don't have any information saved about you.");
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

        return message.reply(response);

      case 'group':
        if (!chat.isGroup) {
          return message.reply("This command is only available in group chats.");
        }

        const groupMemory = await MemoryService.getMemory(chat.id._serialized);
        if (!groupMemory) {
          return message.reply("I don't have any group information saved yet.");
        }

        let groupResponse = `📋 *Group Memory for ${chat.name}:*\n`;
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

        return message.reply(groupResponse);

      case 'clear':
        await MemoryService.processFunctionCall({
          action: 'clear',
          chat_id: chat.id._serialized,
          author_id: authorId
        });
        return message.reply("✅ Your personal information has been removed from my memory.");

      case 'cleargroup':
        if (!chat.isGroup) {
          return message.reply("This command is only available in group chats.");
        }

        await MemoryService.processFunctionCall({
          action: 'delete',
          chat_id: chat.id._serialized
        });
        return message.reply("✅ Group memory has been cleared.");

      default:
        const commands = [
          "Available memory commands:",
          "• *-memory show*: Shows your personal information",
          "• *-memory clear*: Clears your personal information"
        ];

        if (chat.isGroup) {
          commands.push("• *-memory group*: Shows group memory");
          commands.push("• *-memory cleargroup*: Clears group memory");
        }

        return message.reply(commands.join('\n'));
    }
  }

  private async addMessageToCache(wspMessage: Message, chatId: string) {
    try {
      const aiMessage = await WspWeb.convertWspMsgToAiMsg(wspMessage);
      const items = convertIaMessagesLang([aiMessage]) as any;
      return LLMMessages.getMessages(chatId).push(items[0]);
    } catch (e) {
      logger.error(`Error adding message to cache: ${e}`);
    }
  }

  private async sendStateTyping(chatData: Chat){
    while(this.busyChats.has(chatData.id._serialized)){
      await chatData.sendStateTyping();
      await sleep(2000);
    }
  }

}

const Roboto = new RobotoClass();
export default Roboto;