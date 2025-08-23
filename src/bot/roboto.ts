import { Chat, GroupChat, Message, MessageMedia } from "whatsapp-web.js";
import { AIAnswer, AiMessage, AIProvider, OperationResult } from "../interfaces/ai-interfaces";
import { AIConfig, CONFIG } from "../config";
import WspWeb from "./wsp-web";
import OpenAISvc from "../services/openai-service";
import logger from "../logger";
import { bufferToStream, extractAnswer, getAuthorId, includeName, parseCommand, parseIfJson, sleep } from "../utils";
import { chatConfigurationManager } from "../config/chat-configurations";
import { getTools } from "../config/functions";
import { convertIaMessagesLang } from "./message-conversion";
import CustomOpenAISvc from "../services/openai-custom-service";
import OpenaiCustomService from "../services/openai-custom-service";
import AnthropicSvc from "../services/anthropic-service";
import { CVoices, elevenTTS } from "../services/elevenlabs-service";
import Reminders from "../services/reminder-service";
import MemoryService from "../services/user-memory-service";

class RobotoClass {

  private busyChats = new Set<string>();

  constructor() {
  }

  public async readWspMessage(wspMessage: Message) {

    const chatData: Chat = await wspMessage.getChat();
    const chatId = chatData.id._serialized;
    const chatConfig = await chatConfigurationManager.getChatConfig(chatData.id._serialized, chatData.name);
    const botName = chatConfig.botName;

    if(this.isCommand(wspMessage.body)) return this.commandSelect(wspMessage, chatId)

    const shouldProcess = await this.shouldProcessMessage(wspMessage, chatData, botName);
    if (!shouldProcess) return false;

    try {

      while (this.busyChats.has(chatId)) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      this.busyChats.add(chatId);
      this.sendStateTyping(chatData);

      const memoriesContext = await MemoryService.getFormattedMemorias(chatId);
      const systemPrompt = CONFIG.getSystemPrompt(chatConfig, memoriesContext);

      const aiMessages: AiMessage[] = await WspWeb.generateMessageArray(wspMessage, chatData, chatConfig);
      const aiResponse = await this.sendMessageToAi(aiMessages, systemPrompt, chatId);

      let chatResponse: AIAnswer = extractAnswer(aiResponse, botName);
      if (!chatResponse || !chatResponse.message) return false;

      // If the response includes emoji reaction, react to the message
      if(chatResponse.emojiReact)
        wspMessage.react(chatResponse.emojiReact);

      return WspWeb.returnResponse(wspMessage, chatResponse.message, chatData.isGroup);

    } catch (e) {
      //TODO Handle Error
      logger.error('[readWspMessage] ErrorMessage:'+e.message);
      logger.error('[readWspMessage] Chat context is being reset due to errors');
      this.deleteChatCache(chatId);
      return false;
    } finally {
      this.busyChats.delete(chatId);
      chatData.clearState();
    }

  }

  public async sendMessageToAi(aiMessages: AiMessage[], systemPrompt, chatId){
    const messagesList = convertIaMessagesLang(aiMessages) as any;
    const chatData = await WspWeb.getWspClient().getChatById(chatId);

    switch (AIConfig.ChatConfig.provider){
      case AIProvider.OPENAI:
        return await OpenAISvc.sendMessage(messagesList, systemPrompt, chatId, getTools(chatData));
      case AIProvider.CLAUDE:
        return await AnthropicSvc.sendMessage(messagesList, systemPrompt, chatId, getTools(chatData));
      default:
        return await CustomOpenAISvc.sendMessage(messagesList, systemPrompt, chatId, getTools(chatData));
    }
  }

  public async handleFunction(functionName: string, functionArgs: any): Promise<OperationResult> {

    try {
      const args = parseIfJson(functionArgs);
      logger.info(`[Assistant->handleFunction] Executing function: ${functionName} with args: ${JSON.stringify(args)}`);

      const handlers: Record<string, (args: any) => Promise<OperationResult>> = {

        generate_image: async (args: any) => {
          this.createImage(args);
          return {success: true, result: 'The image is being generated. It may take a few seconds'};
        },
        generate_speech: async (args: any) => {
          const {input, instructions, msg_id, voice_gender} = args;
          await this.sendAudioResponse(msg_id, {instructions, messageToSay: input, voiceGender: voice_gender});
          return {success: true, result: 'The audio has been generated and sent to the user. You should respond with { "message" : null }'};
        },
        reminder_manager: async (args) => {
          return await Reminders.processFunctionCall(args);
        },
        memory_manager: async (args) => {
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

    if(process.env.DEBUG == "1") {
      const contactData = await wspMessage.getContact();
      if (process.env.ADMIN_NUMBER != contactData.number) return false;
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
   * @returns A promise resolving when the command processing is complete
   */
  private async commandSelect(message: Message, chatId: string) {
    const {command, commandMessage} = parseCommand(message.body);
    switch (command) {
      case "chatconfig":
        return await this.handleChatConfigCommand(message, commandMessage!);
      case "reset":
        this.deleteChatCache(chatId);
        return await message.react('👍');
      case "memory":
        return await this.handleMemoryCommand(message, commandMessage!);
      default:
        return true;
    }
  }

  private isCommand(msgbody: string){
    const commands = ['-chatconfig', '-reset'];
    return commands.includes(msgbody.split(' ')[0]);
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
    image_msg_ids: string[]
  }) {

    const wspClient = WspWeb.getWspClient();
    const wspMsg = await wspClient.getMessageById(args.msg_id);
    let imageStreams = null;
    let images;


    if (args.image_msg_ids?.length > 0) {
      imageStreams = await Promise.all(
          args.image_msg_ids.map(async (imgMsgId: string) => {
            const imgMsg = await wspClient.getMessageById(imgMsgId);
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
        quality: 'medium'
      });
    } else {
      images = await OpenaiCustomService.generateImage(args.prompt);
    }

    const media = new MessageMedia("image/png", images[0].b64_json, "image.png");
    const message = await wspMsg.reply(media);

    this.addMessageToCache(message, args.chatId);
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
        const memory = await MemoryService.getUserMemory(chat.id._serialized, authorId);
        if (!memory) {
          return message.reply("I don't have any information saved about you.");
        }

        let response = `📋 *Information I have saved about you:*\n`;
        if (memory.age) response += `👤 Age: ${memory.age}\n`;
        if (memory.profession) response += `💼 Profession: ${memory.profession}\n`;
        if (memory.location) response += `📍 Location: ${memory.location}\n`;
        if (memory.interests?.length) response += `🎯 Interests: ${memory.interests.join(', ')}\n`;
        if (memory.likes?.length) response += `👍 Likes: ${memory.likes.join(', ')}\n`;
        if (memory.dislikes?.length) response += `👎 Dislikes: ${memory.dislikes.join(', ')}\n`;
        if (memory.runningJokes?.length) response += `😄 Running jokes: ${memory.runningJokes.join(', ')}\n`;
        if (memory.nicknames?.length) response += `🏷️ Nicknames: ${memory.nicknames.join(', ')}\n`;
        if (memory.personalNotes?.length) response += `📝 Notes: ${memory.personalNotes.join(', ')}\n`;
        if (memory.jargon && Object.keys(memory.jargon).length > 0) {
          const jargonText = Object.entries(memory.jargon).map(([term, meaning]) => `${term}: ${meaning}`).join(', ');
          response += `🗣️ Your jargon: ${jargonText}\n`;
        }

        return message.reply(response);

      case 'group':
        if (!chat.isGroup) {
          return message.reply("This command is only available in group chats.");
        }

        const groupMemory = await MemoryService.getGroupMemory(chat.id._serialized);
        if (!groupMemory) {
          return message.reply("I don't have any group information saved yet.");
        }

        let groupResponse = `📋 *Group Memory for ${groupMemory.chatName}:*\n`;
        if (groupMemory.groupInterests?.length) groupResponse += `🎯 Group interests: ${groupMemory.groupInterests.join(', ')}\n`;
        if (groupMemory.recurringTopics?.length) groupResponse += `💬 Recurring topics: ${groupMemory.recurringTopics.join(', ')}\n`;
        if (groupMemory.groupLikes?.length) groupResponse += `👍 Group likes: ${groupMemory.groupLikes.join(', ')}\n`;
        if (groupMemory.groupDislikes?.length) groupResponse += `👎 Group dislikes: ${groupMemory.groupDislikes.join(', ')}\n`;
        if (groupMemory.groupRunningJokes?.length) groupResponse += `😄 Group jokes: ${groupMemory.groupRunningJokes.join(', ')}\n`;
        if (groupMemory.groupTraditions?.length) groupResponse += `🎭 Group traditions: ${groupMemory.groupTraditions.join(', ')}\n`;
        if (groupMemory.groupNotes?.length) groupResponse += `📝 Group notes: ${groupMemory.groupNotes.join(', ')}\n`;
        if (groupMemory.groupJargon && Object.keys(groupMemory.groupJargon).length > 0) {
          const jargonText = Object.entries(groupMemory.groupJargon).map(([term, meaning]) => `${term}: ${meaning}`).join(', ');
          groupResponse += `🗣️ Group jargon: ${jargonText}\n`;
        }

        return message.reply(groupResponse);

      case 'clear':
        await MemoryService.processFunctionCall({
          action: 'delete',
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

      switch (AIConfig.ChatConfig.provider) {
        case AIProvider.OPENAI:
          return OpenAISvc.addMessageToCache(items[0], chatId);
        case AIProvider.DEEPSEEK:
          return CustomOpenAISvc.addMessageToCache(items[0], chatId);
        case AIProvider.CLAUDE:
          return AnthropicSvc.addMessageToCache(items[0], chatId);
        default:
          return OpenaiCustomService.addMessageToCache(items[0], chatId);
      }
    } catch (e) {
      logger.error(`Error adding message to cache: ${e}`);
    }
  }

  private deleteChatCache(chatId: string){
    switch (AIConfig.ChatConfig.provider){
      case AIProvider.OPENAI:
        return OpenAISvc.deleteChatCache(chatId);
      case AIProvider.DEEPSEEK:
        return CustomOpenAISvc.deleteChatCache(chatId);
      case AIProvider.CLAUDE:
        return AnthropicSvc.deleteChatCache(chatId);
      default:
        return OpenaiCustomService.deleteChatCache(chatId);
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