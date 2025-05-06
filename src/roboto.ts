import { OpenaiService } from './services/openai-service';
import { Chat, Client, GroupChat, Message, MessageContent, MessageMedia, MessageTypes } from 'whatsapp-web.js';
import {
  bufferToStream,
  extractAnswer,
  getContactName,
  getUnsupportedMessage,
  includeName, isSuperUser,
  logMessage,
  parseCommand
} from './utils';
import logger from './logger';
import { AIConfig, CONFIG } from './config';
import { AIAnswer, AIContent, AiMessage, AIProvider, AIRole } from './interfaces/ai-interfaces';
import NodeCache from 'node-cache';
import { elevenTTS } from './services/elevenlabs-service';
import { ChatConfig } from './config/chat-configurations';
import { ResponseInput } from "openai/resources/responses/responses";
import { AITools } from "./config/openai-functions";
import { ChatConfiguration } from "./interfaces/chat-configuration";
import path from "node:path";
import * as fs from "node:fs";

export interface ChatInfo {
  id: string;
  busy: boolean;
  imageRetryCount: number;
}

export class RobotoClass {

  private openAIService: OpenaiService;
  private allowedTypes = [MessageTypes.STICKER, MessageTypes.TEXT, MessageTypes.IMAGE, MessageTypes.VOICE, MessageTypes.AUDIO];
  private cache: NodeCache;
  private chatInfoList: ChatInfo[];
  private whatsappClient: Client;
  private chatConfig: ChatConfig;

  public constructor(client: Client) {
    this.whatsappClient = client;
    this.openAIService = new OpenaiService();
    this.cache = new NodeCache();
    this.chatConfig = new ChatConfig();
    this.chatInfoList = [];
  }

  private getChatInfo(id: string): ChatInfo {
    let data: ChatInfo = this.chatInfoList.find(g => g.id === id);
    if (!data) {
      data = {id: id, busy: false, imageRetryCount: 0};
      this.chatInfoList.push(data);
    }
    return data;
  }

  /**
   * Handles an incoming WhatsApp message and determines if and how to respond.
   *
   * - Filters by allowed message types (text, sticker, image, voice, audio).
   * - In group chats, only responds when mentioned or if quoting the bot.
   * - Parses commands (prefixed with “-”) and dispatches them.
   * - Manages per-chat processing locks to avoid concurrent handling.
   * - Builds AI context, sends it to the AI service, and delivers the reply (text, emoji reaction or audio).
   *
   * @param message  The incoming Message object from whatsapp-web.js.
   * @returns        Promise<boolean|null> resolving to true if a response was sent, false if ignored, or null if no reply needed.
   */
  public async readMessage(message: Message) {

    const chatData: Chat = await message.getChat();
    const chatInfo = this.getChatInfo(chatData.id._serialized);

    try {

      // Extract the data input (extracts command e.g., "-a", and the message)
      const {command, commandMessage} = parseCommand(message.body);
      const chatCfg = this.chatConfig.getChatConfig(chatData.id._serialized, chatData.name);

      // If it's a "Broadcast" message, it's not processed
      if (chatData.id.user == 'status' || chatData.id._serialized == 'status@broadcast') return false;

      // Evaluates whether the message type will be processed
      if (!this.allowedTypes.includes(message.type)) return false;

      // Evaluates if it should respond
      const isQuoted = message.hasQuotedMsg ? (await message.getQuotedMessage()).fromMe : false;
      const isMentioned = includeName(message.body, chatCfg.botName);

      if (!isQuoted && !isMentioned && !command && chatData.isGroup) return false;

      while (chatInfo.busy) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      chatInfo.busy = true;

      // Logs the message
      logger.info('[ProcessMessage] Starting message processing');
      logMessage(message, chatData);
      await chatData.sendStateTyping();

      // Evaluates if it should go to the command flow
      if (!!command) {
        await this.commandSelect(message);
        return true;
      }

      //Generate Message Array for AI
      const aiMessages: AiMessage[] = await this.generateMessageArray(chatData, chatCfg);
      const aiResponse: string = await this.sendToAI(message, aiMessages, chatCfg);

      if (!aiResponse) {
        logger.info('[ProcessMessage] Operation without response. Done.');
        return null;
      }

      let chatResponse: AIAnswer = extractAnswer(aiResponse, chatCfg.botName);

      //If a valid response cannot be extracted, the process ends.
      if (!chatResponse.message) return;

      if (chatResponse.emojiReact)
        message.react(chatResponse.emojiReact);

      logger.info('[ProcessMessage] Operation completed.');
      return this.returnResponse(message, chatResponse.message, chatData.isGroup);

    } catch (e: any) {
      logger.error(e.message);
      return message.reply('Error 😔');
    } finally {
      chatData.clearState();
      chatInfo.busy = false;
      chatInfo.imageRetryCount = 0;
    }
  }

  /**
   * Dispatches and executes a chat command parsed from message body.
   *
   * Supported commands:
   * - “-chatconfig …”: Manage per-chat prompt and bot name settings.
   * - “-reset”: Reset the conversation context.
   *
   * @param message         The Message object containing the command.
   * @returns               Promise<void> that completes when command handling is done.
   */
  private async commandSelect(message: Message) {
    const {command, commandMessage} = parseCommand(message.body);
    switch (command) {
        // case "chatconfig":
        //   return await this.handleChatConfigCommand(message, commandMessage!);
      case "reset":
        return await message.react('👍');
      case "reloadConfig":
        await message.react('👍');
        return await this.chatConfig.reloadConfigurations();
      default:
        return true;
    }
  }

  /**
   * Builds an ordered array of AiMessage objects representing recent chat history.
   *
   * - Fetches up to maxMsgsLimit recent messages.
   * - Resets context if a “-reset” command is found in history.
   * - Filters out messages older than maxHoursLimit.
   * - Downloads and embeds media (images, voice) up to configured limits.
   * - Initiates transcription for voice messages and waits for results.
   *
   * @param chatData           The Chat object representing the conversation.
   * @param chatCfg  ChatConfiguration with custom prompts, bot name, etc.
   * @returns                  Promise<AiMessage[]> array of formatted messages for AI consumption.
   */
  private async generateMessageArray(chatData: Chat, chatCfg: ChatConfiguration): Promise<AiMessage[]> {

    const actualDate = new Date();

    // Initialize an array of messages
    const messageList: AiMessage[] = [];

    // Placeholder for promises for transcriptions - Image Counting
    let transcriptionPromises: { index: number, promise: Promise<string> }[] = [];
    let imageCount: number = 0;

    // Retrieve the last 'limit' number of messages to send them in order
    const fetchedMessages = await chatData.fetchMessages({limit: chatCfg.maxMsgsLimit});
    // Check for "-reset" command in chat history to potentially restart context
    const resetIndex = fetchedMessages.map(msg => msg.body).lastIndexOf("-reset");
    const messagesToProcess = resetIndex >= 0 ? fetchedMessages.slice(resetIndex + 1) : fetchedMessages;

    for (const msg of messagesToProcess.reverse()) {
      try {
        // Validate if the message was written less than 24 (or maxHoursLimit) hours ago; if older, it's not considered
        const msgDate = new Date(msg.timestamp * 1000);
        if ((actualDate.getTime() - msgDate.getTime()) / (1000 * 60 * 60) > chatCfg.maxHoursLimit) break;

        // Checks if a message already exists in the cache
        const cachedMessage = this.getCachedMessage(msg);

        // Check if the message includes media or if it is of another type
        const isImage = msg.type === MessageTypes.IMAGE || msg.type === MessageTypes.STICKER;
        const isAudio = msg.type === MessageTypes.VOICE || msg.type === MessageTypes.AUDIO;
        const isOther = !isImage && !isAudio && msg.type != 'chat';

        // Limit the number of processed images to only the last few and ignore audio if cached
        const media = (isImage && imageCount < chatCfg.maxImages) || (isAudio && !cachedMessage) ?
            await msg.downloadMedia() : null;

        if (media && isImage) imageCount++;

        const role = (!msg.fromMe || isImage) ? AIRole.USER : AIRole.ASSISTANT;
        const name = msg.fromMe ? chatCfg.botName : (await getContactName(msg));

        // Assemble the content as a mix of text and any included media
        const content: Array<AIContent> = [];
        if (isImage && media) content.push({
          type: 'image',
          value: media.data,
          media_type: media.mimetype,
          image_id: msg.id._serialized
        });
        if (isImage && !media) content.push({type: 'text', value: '<Unprocessed image>'});
        if (isOther) content.push({type: 'text', value: getUnsupportedMessage(msg.type, msg.body)});
        if (isAudio && media && !cachedMessage) {
          transcriptionPromises.push({index: messageList.length, promise: this.transcribeVoice(media, msg, chatCfg)});
          content.push({type: 'audio', value: '<Transcribing voice message...>'});
        }
        if (isAudio && cachedMessage) content.push({type: 'audio', value: cachedMessage});
        if (msg.body && !isOther) content.push({type: 'text', value: msg.body});

        messageList.push({role: role, name: name, content: content});
      } catch (e: any) {
        logger.error(`Error reading message - msg.type:${msg.type}; msg.body:${msg.body}. Error:${e.message}`);
      }
    }

    // If no new messages are present, return without action
    if (messageList.length == 0) return;

    // Wait for all transcriptions to complete
    const transcriptions = await Promise.all(transcriptionPromises.map(t => t.promise));
    transcriptionPromises.forEach((transcriptionPromise, idx) => {
      const transcription = transcriptions[idx];
      const messageIdx = transcriptionPromise.index;
      messageList[messageIdx].content = messageList[messageIdx].content.map(c =>
          c.type === 'audio' && c.value === '<Transcribing voice message...>' ? {
            type: 'audio',
            value: transcription
          } : c
      );
    });

    return messageList;
  }

  /**
   * Converts and sends a list of AiMessage objects to the OpenAI service (with tool support).
   *
   * - Prepends the system prompt.
   * - Converts messages into the OpenAI ResponseInput format.
   * - Invokes OpenaiService.sendChatWithTools with configured tools.
   *
   * @param messageList      Array of AiMessage representing the conversation.
   * @param message          The original Message (for context and tool callback).
   * @param chatCfg              ChatConfiguration containing prompt info and bot name.
   * @returns                 Promise<string> the raw AI response text.
   */
  private async sendToAI(message: Message, messageList: AiMessage[], chatCfg: ChatConfiguration) {
    const systemPrompt = CONFIG.getSystemPrompt(chatCfg);
    const convertedMessageList: ResponseInput = this.convertIaMessagesLang(messageList.reverse(), systemPrompt) as ResponseInput;
    return await this.openAIService.sendChatWithTools(convertedMessageList, 'text', AITools, message, chatCfg);
  }

  /**
   * Synthesizes speech from text and sends it as a voice message.
   *
   * - Chooses between ElevenLabs or OpenAI TTS based on configuration.
   * - Caches the text-to-speech mapping for later retrieval.
   *
   * @param message         The Message object to reply to.
   * @param messageToSay    The text to convert into speech.
   * @param responseFormat  Optional audio format (e.g. “mp3”).
   * @param voice           Optional voice identifier.
   * @param instructions    Optional style/pronunciation instructions.
   * @param chatCfg
   * @returns               Promise<void> resolves when the voice message is sent.
   */
  private async speak(message: Message, messageToSay: string | undefined, chatCfg: ChatConfiguration, responseFormat?: string, voice?: string, instructions?: string) {
    try {
      let base64Audio;
      if (chatCfg.ttsProvider == AIProvider.ELEVENLABS) {
        base64Audio = await elevenTTS(messageToSay);
      } else {
        const audioBuffer = await this.openAIService.speech(messageToSay, chatCfg, responseFormat, voice, instructions);
        base64Audio = audioBuffer.toString('base64');
      }

      let audioMedia = new MessageMedia('audio/mp3', base64Audio, 'voice.mp3');

      const repliedMsg = await message.reply(audioMedia, undefined, {sendAudioAsVoice: true});

      this.cache.set(repliedMsg.id._serialized, messageToSay, CONFIG.botConfig.nodeCacheTime);
    } catch (e: any) {
      logger.error(`Error in speak function: ${e.message}`);
      throw e;
    }
  }

  /**
   * Transforms an array of AiMessage into the format required by the target AI provider.
   *
   * - Supports system/user/assistant roles.
   * - Encodes text, audio, and image content appropriately.
   * - Prepends an optional system prompt.
   *
   * @param messageList   Array of AiMessage to convert.
   * @param systemPrompt  Optional system prompt to include at the start.
   * @returns             ResponseInput[] formatted for the OpenAI API.
   */
  private convertIaMessagesLang(messageList: AiMessage[], systemPrompt?: string): ResponseInput {
    const responseAPIMessageList: ResponseInput = [];
    messageList.forEach(msg => {
      const gptContent: Array<any> = [];
      msg.content.forEach(c => {
        const fromBot = msg.role == AIRole.ASSISTANT;
        if (['text', 'audio'].includes(c.type)) gptContent.push({
          type: fromBot ? 'output_text' : 'input_text',
          text: JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format: 'json_object'}),
        });
        if (['image'].includes(c.type)) {
          gptContent.push({
            type: 'input_image',
            image_url: `data:${c.media_type};base64,${c.value}`
          });
          gptContent.push({
            image_id: c.image_id,
            author: msg.name,
            note: 'refer to this image by its image_id'
          });
        }
      })
      responseAPIMessageList.push({content: gptContent, role: msg.role});
    })

    responseAPIMessageList.unshift({role: AIRole.SYSTEM, content: systemPrompt});
    return responseAPIMessageList;
  }

  /**
   * Processes “-chatconfig” subcommands to customize per-chat behavior.
   *
   * Supported subcommands:
   * - prompt [text]:   Set a custom personality prompt.
   * - botname [name]:  Change the bot’s display name.
   * - remove:          Reset to default configuration.
   * - show:            Display current settings.
   *
   * - In group chats, only administrators may modify settings.
   *
   * @param message      The Message object containing the command.
   * @param commandText  The subcommand and its arguments (without the prefix).
   * @returns            Promise<Message> the reply message confirming action.
   */
  private async handleChatConfigCommand(message: Message, commandText: string) {
    const chat = await message.getChat();
    const isGroup = chat.isGroup;

    // Solo verificar permisos de administrador en grupos
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

        const existingConfig = this.chatConfig.getChatConfig(chat.id._serialized);

        const updateOptions: any = {
          promptInfo: existingConfig?.promptInfo || CONFIG.botConfig.promptInfo,
          botName: existingConfig?.botName
        };

        if (subCommand === 'prompt') updateOptions.promptInfo = value;
        else updateOptions.botName = value;

        const updatedConfig = await this.chatConfig.updateChatConfig(
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
        const removed = this.chatConfig.removeChatConfig(chat.id._serialized);
        return message.reply(
            removed
                ? `✅ The custom prompt and bot name have been removed. The bot will use the default configuration.`
                : `This ${isGroup ? 'group' : 'chat'} did not have a custom configuration.`
        );

      case 'show':
        const currentConfig = this.chatConfig.getChatConfig(chat.id._serialized);
        if (!currentConfig) return message.reply(`This ${isGroup ? 'group' : 'chat'} does not have a custom configuration.`);

        let response = currentConfig.promptInfo ? `Current personality: ${currentConfig.promptInfo}` : ``;
        if (currentConfig.botName) response += `\nBot name: ${currentConfig.botName ?? CONFIG.botConfig.botName}`;

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


  /**
   * Transcribes a voice message to text, using cache when possible.
   *
   * - Checks NodeCache for existing transcription.
   * - Converts base64 media to a stream.
   * - Sends to the configured transcription service (e.g. Whisper).
   * - Caches the resulting text for future reuse.
   *
   * @param media    The MessageMedia containing base64-encoded audio.
   * @param message  The original Message for cache key.
   * @param chatCfg
   * @returns         Promise<string> the transcribed text or error placeholder.
   */
  private async transcribeVoice(media: MessageMedia, message: Message, chatCfg: ChatConfiguration): Promise<string> {
    try {

      // Check if the transcription exists in the cache
      const cachedMessage = this.getCachedMessage(message);
      if (cachedMessage) return cachedMessage;

      // Convert the base64 media data to a Buffer
      const audioBuffer = Buffer.from(media.data, 'base64');

      // Convert the buffer to a stream
      const audioStream = bufferToStream(audioBuffer);

      logger.debug(`[OpenAI->transcribeVoice] Starting audio transcription`);

      const transcribedText = await this.openAIService.transcription(audioStream, chatCfg);

      // Log the transcribed text
      logger.debug(`[OpenAI->transcribeVoice] Transcribed text: ${transcribedText}`);

      // Store in cache
      this.cache.set(message.id._serialized, transcribedText, CONFIG.botConfig.nodeCacheTime);

      return transcribedText;

    } catch (error: any) {
      // Error handling
      logger.error(`Error transcribing voice message: ${error.message}`);
      return '<Error transcribing voice message>';
    }
  }


  /**
   * Invokes a local handler for a tool (function_call) issued by the AI.
   *
   * - Maps functionName to a handler that returns a string result.
   * - Example: “generate_speech” triggers speak() and returns null.
   *
   * @param functionName  The name of the AI-invoked function.
   * @param args          The function arguments object.
   * @param message       The original Message for context.
   * @param chatCfg
   * @returns             Promise<string> the result or an error/unrecognized message.
   */
  public async executeFunctions(functionName: string, args: any, message: Message, chatCfg: ChatConfiguration): Promise<string> {

    const chatInfo = this.getChatInfo(chatCfg.id);

    const handlers: Record<string, (args: any) => Promise<string>> = {
      generate_speech: async (args) => {
        const {input, instructions, voice} = args;
        this.speak(message, input, chatCfg, 'mp3', voice, instructions);
        return null;
      },

      web_search: async (args) => {
        return await this.openAIService.webSearch(args.query);
      },

      create_image: async (args) => {
        const canCreateImages = await isSuperUser(message);
        if (!canCreateImages) return `The user who requested this does not have permission to create or edit images. They must request authorization from Diego.`

        if (args.wait_message) await message.reply(args.wait_message);
        try {
          const images = await this.openAIService.createImage(args.prompt, chatCfg, {
            background: args.background,
            quality: 'low'
          });
          const media = new MessageMedia("image/png", images[0].b64_json, "image.png");
          await message.reply(media);
        } catch (e) {
          logger.error(`[${e.code}]: ${e.message}`);
          if (chatInfo.imageRetryCount >= CONFIG.botConfig.maxImageCreationRetry || e.code == '400' ||  !e.message.toLowerCase().includes('safety system'))
            return `Error creating image: ${e.message}`;
          chatInfo.imageRetryCount++;
          return `OpenAI’s safety filters blocked the request. Please call create_image again with a different phrasing. Rephrase the prompt to avoid sensitive content.`;
        }
        return null;
      },

      edit_image: async (args) => {
        const canCreateImages = await isSuperUser(message);
        if (!canCreateImages) return `The user who requested this does not have permission to create or edit images. They must request authorization from Diego.`

        const imageStreams = await Promise.all(
            args.imageIds.map(async (imageId: string) => {

              if (imageId.startsWith("LOCAL-")) {
                const filename = imageId.replace("LOCAL-", "") + ".jpg";
                const filePath = path.join(__dirname, '/../assets/images/', filename);
                if (!fs.existsSync(filePath)) {
                  throw new Error(`No se encontró ningún archivo local con id=${imageId}`);
                }
                const fileStream = fs.createReadStream(filePath);
                return fileStream;
              }

              const refMsg = await this.whatsappClient.getMessageById(imageId);
              if (!refMsg) throw new Error(`No se encontró ningún mensaje con imageId=${imageId}`);

              const media = await refMsg.downloadMedia();
              if (!media || !media.data) throw new Error(`No se pudo descargar el media de ${imageId}`);

              const buffer = Buffer.from(media.data, 'base64');
              return bufferToStream(buffer);
            })
        );

        let maskStream;
        if (args.mask) maskStream = bufferToStream(Buffer.from(args.mask, 'base64'));
        if (args.wait_message) await message.reply(args.wait_message);

        try {
          const edited = await this.openAIService.editImage(imageStreams, args.prompt, chatCfg, maskStream, {
            background: args.background,
            quality: 'medium', size: "1536x1024"
          });
          const mediaReply = new MessageMedia("image/png", edited[0].b64_json, "edited.png");
          await message.reply(mediaReply);
        } catch (e) {
          logger.error(`[${e.code}]: ${e.message}`);
          if (chatInfo.imageRetryCount >= CONFIG.botConfig.maxImageCreationRetry || e.code == '400' || !e.message.toLowerCase().includes('safety system'))
            return `Error editing image: ${e.message}`;
          chatInfo.imageRetryCount++;
          return `OpenAI’s safety filters blocked the request. Please call edit_image again with a different phrasing. Rephrase the prompt to avoid sensitive content.`;
        }
        return null;
      }
    };
    try {
      if (handlers[functionName]) {
        return await handlers[functionName](args);
      }
      return `Function not recognized: ${functionName}`;
    } catch (error) {
      logger.error(error.message);
      return `Error executing function: ${functionName}`;
    }
  }

  /**
   * Sends a textual reply appropriately based on chat context.
   *
   * - In group chats: replies to the original message (threaded).
   * - In direct chats: sends a new message to the sender.
   *
   * @param message     The original Message to reply to.
   * @param responseMsg The text content to send.
   * @param isGroup     True if this is a group chat.
   * @returns           Promise<Message> of the sent reply.
   */
  private returnResponse(message: Message, responseMsg: MessageContent, isGroup: boolean) {
    if (isGroup) return message.reply(responseMsg);
    else return this.whatsappClient.sendMessage(message.from, responseMsg);
  }

  /**
   * Retrieves a cached string value associated with a message ID.
   *
   * - Uses NodeCache to look up stored transcriptions or responses.
   *
   * @param msg  The Message object whose ID is used as cache key.
   * @returns    The cached string or undefined if not found.
   */
  private getCachedMessage(msg: Message) {
    return this.cache.get<string>(msg.id._serialized);
  }

}