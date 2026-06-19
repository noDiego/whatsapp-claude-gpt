import { Chat, GroupChat, Message, MessageMedia } from "whatsapp-web.js";
import { AIAnswer, AiMessage, AIProvider, AIService, OperationResult, ToolExecutionContext } from "../interfaces/ai-interfaces";
import { AIConfig, CONFIG } from "../config";
import WspWeb from "./wsp-web";
import OpenAISvc from "../services/openai-service";
import logger from "../logger";
import { bufferToStream, extractAnswer, getAuthorId, includeName, parseCommand, parseIfJson, sanitizeForLog, sleep } from "../utils";
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

class RobotoClass {

  // Per-chat promise queue that serializes message processing.
  // Each chat's promise chain ensures only one message is processed at a time.
  private chatProcessingQueue = new Map<string, Promise<void>>();
  // Per-chat typing flag used by sendStateTyping to know when to stop.
  private chatTypingFlags = new Map<string, boolean>();
  private botEnabled = true;
  private chatImageRetry = new Map<string, number>();
  private readonly MAX_IMAGE_RETRY_KEYS = 500;
  // Rate limiting: key -> timestamps[] for sliding window.
  private rateLimitTracker = new Map<string, number[]>();
  private readonly MAX_RATE_LIMIT_TRACKER_KEYS = 500;

  constructor() {
  }

  public async readWspMessage(wspMessage: Message) {

    let chatData: Chat | undefined;
    let chatId: string | undefined;
    let resolveCurrent: (() => void) | undefined;

    try {

      chatData = await wspMessage.getChat();
      chatId = chatData.id._serialized;

      const contactData = await wspMessage.getContact();
      const chatConfig = await chatConfigurationManager.getChatConfig(chatData.id._serialized, chatData.name);
      const botName = chatConfig.botName;
      const isAdmin = CONFIG.BotConfig.adminNumbers.includes(contactData.number);

      if (this.isCommand(wspMessage, isAdmin)) {
        if (CONFIG.BotConfig.restrictedNumbers.includes(contactData.number)) {
          logger.debug(`[readWspMessage] Restricted number ${contactData.number} attempted command. Ignored.`);
          return false;
        }
        return this.commandSelect(wspMessage, chatId, isAdmin);
      }

      const shouldProcess = await this.shouldProcessMessage(wspMessage, chatData, botName);
      if (!shouldProcess) return false;

      // Rate limiting: skip AI call if author/chat exceeds the configured window.
      // Admins bypass rate limiting.
      const authorId = getAuthorId(wspMessage);
      if (!isAdmin && !this.checkRateLimit(chatData.isGroup ? chatId : authorId)) {
        logger.debug(`[readWspMessage] Rate limited: ${chatData.isGroup ? 'chat' : 'author'} ${chatId}`);
        return false;
      }

      // Serialize processing per chat using a promise queue.
      // This replaces the polling-based busyChats Set with a deterministic queue.
      const previous = this.chatProcessingQueue.get(chatId) ?? Promise.resolve();
      const current = new Promise<void>((resolve) => { resolveCurrent = resolve; });
      this.chatProcessingQueue.set(chatId, current);

      await previous;

      // Start typing indicator as a fire-and-forget task.
      // It stops when chatTypingFlags is cleared in finally.
      this.chatTypingFlags.set(chatId, true);
      this.sendStateTyping(chatData).catch((e) => {
        logger.error(`[sendStateTyping] Error for chat ${chatId}: ${e.message}`);
      });

      const memoriesContext = await MemoryService.getMemoryContext(chatId, !chatData.isGroup? getAuthorId(wspMessage): null, chatData.isGroup);
      const systemPrompt = CONFIG.getSystemPrompt(chatConfig, memoriesContext);

      const aiMessages: AiMessage[] = await WspWeb.generateMessageArray(wspMessage, chatData, chatConfig, this.hasChatCache(chatId));

      const toolContext: ToolExecutionContext = {
        chatId: chatData.id._serialized,
        chatName: chatData.name,
        messageId: wspMessage.id._serialized,
        authorId: getAuthorId(wspMessage),
        isGroup: chatData.isGroup,
        imageMessageIds: aiMessages
          .flatMap(m => m.content)
          .filter(c => c.type === 'image' && c.msg_id)
          .map(c => c.msg_id!)
      };

      const aiResponse = await this.sendMessageToAi(aiMessages, systemPrompt, chatConfig, true, toolContext);

      let chatResponse: AIAnswer = extractAnswer(aiResponse, botName);
      if (!chatResponse || !chatResponse.message) {
        if (!aiResponse || aiResponse.trim() === '') {
          logger.warn(`[readWspMessage] AI response was empty for chat ${chatId}`);
        } else {
          logger.warn(`[readWspMessage] Failed to extract answer from AI response for chat ${chatId}`);
        }
        return false;
      }

      // If the response includes emoji reaction, react to the message
      if (chatResponse.emojiReact)
        wspMessage.react(chatResponse.emojiReact);

      return WspWeb.returnResponse(wspMessage, chatResponse.message, chatData.isGroup);

    } catch (e) {
      //TODO Handle Error
      logger.error(`[readWspMessage] ErrorMessage: ${JSON.stringify(sanitizeForLog(e))}`);
      logger.error('[readWspMessage] Chat context is being reset due to errors');
      if (chatId) this.deleteChatCache(chatId);
      return false;
    } finally {
      // Clean up typing flag so sendStateTyping stops its loop.
      if (chatId) {
        this.chatTypingFlags.delete(chatId);
      }
      // Resolve the current promise so the next message in the queue can proceed.
      resolveCurrent?.();
      // clearState is an external API call that may fail; catch errors to avoid
      // unhandled rejections that would crash the process.
      if (chatData) {
        try {
          await chatData.clearState();
        } catch (e: any) {
          logger.error(`[clearState] Error for chat ${chatId}: ${e.message}`);
        }
      }
    }

  }

  /**
   * Resolves the AI service instance for the given provider.
   * Mapping: OPENAI → OpenAISvc, CLAUDE → AnthropicSvc, everything else → CustomOpenAISvc.
   */
  private resolveAIService(provider = AIConfig.ChatConfig.provider): AIService {
    switch (provider) {
      case AIProvider.OPENAI:
        return OpenAISvc;
      case AIProvider.CLAUDE:
        return AnthropicSvc;
      default:
        return CustomOpenAISvc;
    }
  }

  public async sendMessageToAi(aiMessages: AiMessage[], systemPrompt, chatConfig: ChatConfiguration, withTools = true, toolContext?: ToolExecutionContext){
    const messagesList = convertIaMessagesLang(aiMessages) as any;
    const chat = await wspWeb.getWspClient().getChatById(chatConfig.chatId);
    const tools = withTools ? getTools(chat) : undefined;

    return await this.resolveAIService().sendMessage(messagesList, systemPrompt, chatConfig, tools, toolContext);
  }

  public async handleFunction(functionName: string, functionArgs: any, context?: ToolExecutionContext): Promise<OperationResult> {

    try {
      const args = parseIfJson(functionArgs);

      // Sanitize args for logging via standard sanitizer.
      logger.info(`[Assistant->handleFunction] Executing function: ${functionName} with args: ${JSON.stringify(sanitizeForLog(args))}`);

      const handler = this.getToolHandler(functionName);
      if (!handler) {
        logger.warn(`[Assistant->handleFunction] Unknown function requested: ${functionName}`);
        return { success: false, result: `Unknown tool: ${functionName}` };
      }

      return await handler(args, context);

    } catch (e) {
      logger.error(JSON.stringify(sanitizeForLog(e)));
      return {success: false, result: `Error executing function ${functionName}: ${e.message}`};
    }

  }

  private getToolHandler(functionName: string): ((args: any, context?: ToolExecutionContext) => Promise<OperationResult>) | null {
    const handlers: Record<string, (args: any, context?: ToolExecutionContext) => Promise<OperationResult>> = {

      generate_image: async (args: any, context?: ToolExecutionContext) => {
        // Overwrite model-supplied IDs with server-side context.
        if (context) {
          args.msg_id = context.messageId;
          args.chatId = context.chatId;
          // Only allow image_msg_ids that are present in the current context.
          if (args.image_msg_ids?.length > 0) {
            args.image_msg_ids = args.image_msg_ids.filter((id: string) =>
              context.imageMessageIds.includes(id)
            );
          }
        }
        const imageRetryCount = this.chatImageRetry.get(args.chatId);
        try {
          await this.createImage(args);
          this.chatImageRetry.delete(args.chatId);
          return { success: true, result: 'The image has been generated and sent to the chat.'};
        } catch (e){
          logger.error(`[${e.code}]: ${e.message}`);
          if (imageRetryCount >= 3 || e.code == '400' || !e.message.toLowerCase().includes('safety system')) {
            this.chatImageRetry.delete(args.chatId);
            return {success: false, result: `Error generating image: ${e.message}.`};
          }
          // FIFO eviction: cap chatImageRetry to prevent unbounded growth.
          if (!this.chatImageRetry.has(args.chatId) && this.chatImageRetry.size >= this.MAX_IMAGE_RETRY_KEYS) {
            const firstKey = this.chatImageRetry.keys().next().value;
            if (firstKey !== undefined) this.chatImageRetry.delete(firstKey);
          }
          this.chatImageRetry.set(args.chatId, imageRetryCount ? imageRetryCount + 1 : 1);
          const match = e.message.match(/safety_violations=\[([^\]]*)\]/);
          const safety_violations = match ? match[1] : null;
          return { success: false, result: `Safety filters blocked the request (safety_violations:${safety_violations}). Please call generate_image again with a different phrasing. Rephrase the prompt to avoid sensitive content.`};
        }
      },
      generate_speech: async (args: any, context?: ToolExecutionContext) => {
        // Use server-side messageId instead of model-supplied msg_id.
        const msgId = context?.messageId ?? args.msg_id;
        const {input, instructions, voice_gender} = args;
        await this.sendAudioResponse(msgId, {instructions, messageToSay: input, voiceGender: voice_gender});
        return {success: true, result: 'The audio has been generated and sent to the user. You should respond with { "message" : null } to avoid duplicate messages'};
      },
      reminder_manager: async (args, context?: ToolExecutionContext) => {
        return await Reminders.processFunctionCall(args, context);
      },
      user_memory_manager: async (args, context?: ToolExecutionContext) => {
        // Overwrite model-supplied IDs with server-side context to prevent
        // the model from reading/writing another user's memory.
        if (context) {
          args.chat_id = context.chatId;
          args.author_id = context.authorId;
        }
        return await MemoryService.processFunctionCall(args, context);
      },
      group_memory_manager: async (args, context?: ToolExecutionContext) => {
        // Overwrite model-supplied chat_id; only allowed in groups.
        if (context) {
          if (!context.isGroup) {
            return { success: false, result: 'Group memory is only available in group chats.' };
          }
          args.chat_id = context.chatId;
        }
        return await MemoryService.processFunctionCall(args, context);
      }
    };

    return handlers[functionName] ?? null;
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
   * Opportunistic pruning: removes entries from rateLimitTracker whose
   * timestamps have all expired outside the current window.
   */
  private pruneRateLimitTracker(windowStart: number): void {
    for (const [key, timestamps] of this.rateLimitTracker) {
      const active = timestamps.filter(t => t > windowStart);
      if (active.length === 0) {
        this.rateLimitTracker.delete(key);
      } else if (active.length !== timestamps.length) {
        this.rateLimitTracker.set(key, active);
      }
    }
  }

  /**
   * Rate limit check using a sliding window per key (authorId for direct, chatId for groups).
   * Returns true if the request is allowed, false if rate limited.
   * Admins bypass rate limiting (checked in caller).
   */
  private checkRateLimit(key: string): boolean {
    const max = CONFIG.BotConfig.rateLimitMax;
    if (!max || max <= 0) return true; // Disabled

    const windowSec = CONFIG.BotConfig.rateLimitWindowSec;
    const now = Date.now();
    const windowStart = now - windowSec * 1000;

    // Opportunistic pruning: clean up expired entries across the map.
    this.pruneRateLimitTracker(windowStart);

    let timestamps = this.rateLimitTracker.get(key);
    if (!timestamps) {
      // FIFO eviction: cap rateLimitTracker to prevent unbounded growth.
      if (this.rateLimitTracker.size >= this.MAX_RATE_LIMIT_TRACKER_KEYS) {
        const firstKey = this.rateLimitTracker.keys().next().value;
        if (firstKey !== undefined) this.rateLimitTracker.delete(firstKey);
      }
      timestamps = [now];
      this.rateLimitTracker.set(key, timestamps);
      return true;
    }

    // Remove expired entries for current key (already pruned above, but filter for safety).
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= max) {
      this.rateLimitTracker.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    this.rateLimitTracker.set(key, timestamps);
    return true;
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
        this.deleteChatCache(chatId);
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
    output_format: "png" | "jpg" | "webp" | "jpeg",
    send_as: "image"| "sticker",
    size: any,
    image_msg_ids: string[],
    quality: 'low'|'medium' | 'high'| 'auto',
  }) {

    const wspClient = WspWeb.getWspClient();
    const wspMsg = await wspClient.getMessageById(args.msg_id);
    let imageStreams = null;
    let images;

    // Normalize defaults for optional fields
    const outputFormat = args.output_format || 'png';
    // Normalize jpeg/jpg to a consistent internal format
    const normalizedFormat = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
    const sendAs = args.send_as || 'image';
    const background = args.background && args.background !== 'auto' ? args.background : undefined;
    const quality = args.quality && args.quality !== 'auto' ? args.quality : undefined;

    if (args.image_msg_ids?.length > 0) {
      imageStreams = await Promise.all(
          args.image_msg_ids.map(async (imgMsgId: string) => {
            const imgMsg = await wspClient.getMessageById(imgMsgId);
            const media = await WspWeb.extractMedia(imgMsg);
            if (media.errorMedia) throw new Error(`Image reference error: ${media.errorMedia}`);

            const buffer = Buffer.from(media.mediaData!.data, 'base64');
            return bufferToStream(buffer);
          })
      );
    }

    if (AIConfig.ImageConfig.provider == AIProvider.OPENAI) {
      images = await OpenAISvc.generateImage({
        prompt: args.prompt,
        imageStreams: imageStreams,
        background: background as any,
        output_format: normalizedFormat as any,
        quality: quality as any
      });
    } else {
      images = await OpenaiCustomService.generateImage(args.prompt);
    }

    if (!images || !Array.isArray(images) || images.length === 0 || !images[0].b64_json) {
      throw new Error('Image generation returned no valid image data.');
    }

    // Determine MIME type: map jpg->jpeg for MessageMedia, but keep png/webp as-is
    const mimeSuffix = normalizedFormat === 'jpg' ? 'jpeg' : normalizedFormat;
    const media = new MessageMedia(`image/${mimeSuffix}`, images[0].b64_json, `image.${normalizedFormat}`);
    const isSticker = sendAs == 'sticker'

    const message = await WspWeb.getWspClient().sendMessage(args.chatId, media, {sendMediaAsSticker: isSticker});

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

      if (!base64Audio) {
        throw new Error('Speech generation returned no audio data.');
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
        const removed = await chatConfigurationManager.removeChatConfig(chat.id._serialized);
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

        const clearResult = await MemoryService.processFunctionCall({
          action: 'clear',
          chat_id: chat.id._serialized
        });
        if (!clearResult.success) {
          return message.reply(`❌ Failed to clear group memory: ${clearResult.result}`);
        }
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

      return this.resolveAIService().addMessageToCache(items[0], chatId);
    } catch (e) {
      logger.error(`Error adding message to cache: ${e}`);
    }
  }

  private deleteChatCache(chatId: string){
    return this.resolveAIService().deleteChatCache(chatId);
  }

  private hasChatCache(chatId: string){
    return this.resolveAIService().hasChatCache(chatId);
  }

  private async sendStateTyping(chatData: Chat){
    const chatId = chatData.id._serialized;
    while(this.chatTypingFlags.has(chatId)){
      try {
        await chatData.sendStateTyping();
      } catch (e: any) {
        logger.error(`[sendStateTyping] Error sending typing state for chat ${chatId}: ${e.message}`);
      }
      await sleep(2000);
    }
  }

}

const Roboto = new RobotoClass();
export default Roboto;
