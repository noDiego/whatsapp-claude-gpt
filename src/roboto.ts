import { OpenaiService } from './services/openai-service';
import { Chat, Client, GroupChat, Message, MessageMedia, MessageTypes } from 'whatsapp-web.js';
import { bufferToStream, getContactName, getUnsupportedMessage, includeName, logMessage, parseCommand } from './utils';
import logger from './logger';
import { AIConfig, CONFIG } from './config';
import { AIAnswer, AIContent, AiMessage, AIProvider, AIRole } from './interfaces/ai-interfaces';
import Anthropic from '@anthropic-ai/sdk';
import { ChatCompletionMessageParam } from 'openai/resources';
import { AnthropicService } from './services/anthropic-service';
import { ImageBlockParam, TextBlock } from '@anthropic-ai/sdk/src/resources/messages';
import NodeCache from 'node-cache';
import { elevenTTS } from './services/elevenlabs-service';
import { chatConfigurationManager } from './config/chat-configurations';
import MessageParam = Anthropic.MessageParam;

export class Roboto {

  private openAIService: OpenaiService;
  private claudeService: AnthropicService;
  private botConfig = CONFIG.botConfig;
  private allowedTypes = [MessageTypes.STICKER, MessageTypes.TEXT, MessageTypes.IMAGE, MessageTypes.VOICE, MessageTypes.AUDIO];
  private cache: NodeCache;
  private groupProcessingStatus: { [key: string]: boolean } = {};

  public constructor() {

    this.openAIService = new OpenaiService();
    this.claudeService = new AnthropicService();
    this.cache = new NodeCache();
  }

  /**
   * Handles incoming WhatsApp messages and decides the appropriate action.
   *
   * This function evaluates incoming messages to determine if a response is needed based on:
   * - Message type (text, image, audio, sticker)
   * - Group context (direct mentions, quoted replies)
   * - Command presence (prefixed with "-")
   *
   * Key functionalities:
   * - Processes commands with the commandSelect method
   * - Manages group processing with a queue system to prevent conflicts
   * - Handles AI response generation through processMessage
   * - Determines response format (text or audio)
   * - Logs messages and manages errors
   *
   * @param message - The incoming Message object from WhatsApp Web.js
   * @param client - The WhatsApp Web.js Client instance
   * @returns A promise resolving to a boolean indicating if a response was sent
   */
  public async readMessage(message: Message, client: Client) {

    const chatData: Chat = await message.getChat();

    try {

      // Extract the data input (extracts command e.g., "-a", and the message)
      const isAudioMsg = message.type == MessageTypes.VOICE || message.type == MessageTypes.AUDIO;
      const {command, commandMessage} = parseCommand(message.body);

      // If it's a "Broadcast" message, it's not processed
      if (chatData.id.user == 'status' || chatData.id._serialized == 'status@broadcast') return false;

      // Evaluates whether the message type will be processed
      if (!this.allowedTypes.includes(message.type) || (isAudioMsg && !AIConfig.SpeechConfig.enabled)) return false;

      const botName = chatData.isGroup
        ? chatConfigurationManager.getBotName(chatData.id._serialized) || this.botConfig.botName
        : this.botConfig.botName;

      // Evaluates if it should respond
      const isSelfMention = message.hasQuotedMsg ? (await message.getQuotedMessage()).fromMe : false;
      const isMentioned = includeName(message.body, botName);

      if (!isSelfMention && !isMentioned && !command && chatData.isGroup) return false;

      while (this.groupProcessingStatus[chatData.id._serialized]) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      this.groupProcessingStatus[chatData.id._serialized] = true;

      // Logs the message
      logMessage(message, chatData);

      // Evaluates if it should go to the command flow
      if (!!command) {
        await chatData.sendStateTyping();
        await this.commandSelect(message);
        await chatData.clearState();
        return true;
      }


      // Sends message to ChatGPT
      chatData.sendStateTyping();
      let chatResponseString: AIAnswer = await this.processMessage(chatData);
      chatData.clearState();

      if (!chatResponseString) return;

      if(chatResponseString.emojiReact)
        message.react(chatResponseString.emojiReact);

      // Evaluate if response message must be Audio or Text
      if (chatResponseString.type.toLowerCase() == 'audio' && AIConfig.SpeechConfig.enabled) {
        return this.speak(message, chatData, chatResponseString.message, 'mp3');
      } else {
        return this.returnResponse(message, chatResponseString.message, chatData.isGroup, client);
      }

    } catch (e: any) {
      logger.error(e.message);
      return message.reply('Error 😔');
    } finally {
      this.groupProcessingStatus[chatData.id._serialized] = false;
    }
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
  private async commandSelect(message: Message) {
    const {command, commandMessage} = parseCommand(message.body);
    switch (command) {
      case "image":
        if (!AIConfig.ImageConfig.enabled) return;
        return await this.createImage(message, commandMessage);
      case "chatconfig":
        return await this.handleChatConfigCommand(message, commandMessage!);
      case "reset":
        return await message.react('👍');
      default:
        return true;
    }
  }

  /**
   * Processes an incoming message and generates an AI response based on chat context.
   *
   * This function is responsible for:
   * 1. Collecting recent chat messages to build conversation context
   * 2. Processing multiple content types (text, images, audio)
   * 3. Handling transcription of voice messages
   * 4. Applying chat-specific configurations (custom prompts, bot names)
   * 5. Selecting the appropriate AI provider and formatting messages accordingly
   *
   * The function limits context by time (messages older than maxHoursLimit are ignored)
   * and resets context if a "-reset" command is found in the chat history.
   *
   * @param chatData - The Chat object representing the conversation
   * @returns A promise that resolves with the AI-generated response or null if no response needed
   */
  private async processMessage(chatData: Chat) {

    const actualDate = new Date();
    const analyzeImages = !AIConfig.ChatConfig.analyzeImageDisabled;

    // Initialize an array of messages
    const messageList: AiMessage[] = [];

    // Placeholder for promises for transcriptions - Image Counting
    let transcriptionPromises: { index: number, promise: Promise<string> }[] = [];
    let imageCount: number = 0;

    // Retrieve the last 'limit' number of messages to send them in order
    const fetchedMessages = await chatData.fetchMessages({limit: this.botConfig.maxMsgsLimit});
    // Check for "-reset" command in chat history to potentially restart context
    const resetIndex = fetchedMessages.map(msg => msg.body).lastIndexOf("-reset");
    const messagesToProcess = resetIndex >= 0 ? fetchedMessages.slice(resetIndex + 1) : fetchedMessages;

    for (const msg of messagesToProcess.reverse()) {
      try {
        // Validate if the message was written less than 24 (or maxHoursLimit) hours ago; if older, it's not considered
        const msgDate = new Date(msg.timestamp * 1000);
        if ((actualDate.getTime() - msgDate.getTime()) / (1000 * 60 * 60) > this.botConfig.maxHoursLimit) break;

        // Checks if a message already exists in the cache
        const cachedMessage = this.getCachedMessage(msg);

        // Check if the message includes media or if it is of another type
        const isImage = msg.type === MessageTypes.IMAGE || msg.type === MessageTypes.STICKER;
        const isAudio = msg.type === MessageTypes.VOICE || msg.type === MessageTypes.AUDIO;
        const isOther = !isImage && !isAudio && msg.type != 'chat';

        // Limit the number of processed images to only the last few and ignore audio if cached
        const media = (isImage && imageCount < this.botConfig.maxImages && analyzeImages) || (isAudio && !cachedMessage) ?
          await msg.downloadMedia() : null;

        if (media && isImage) imageCount++;

        const role = (!msg.fromMe || isImage) ? AIRole.USER : AIRole.ASSISTANT;
        const name = msg.fromMe ? (CONFIG.botConfig.botName) : (await getContactName(msg));

        // Assemble the content as a mix of text and any included media
        const content: Array<AIContent> = [];
        if (isOther || (isAudio && !AIConfig.TranscriptionConfig.enabled))
          content.push({type: 'text', value: getUnsupportedMessage(msg.type, msg.body)});
        else if (isAudio && media && !cachedMessage) {
          transcriptionPromises.push({index: messageList.length, promise: this.transcribeVoice(media, msg)});
          content.push({type: 'audio', value: '<Transcribing voice message...>'});
        }
        if (isAudio && cachedMessage) content.push({type: 'audio', value: cachedMessage});
        if (isImage && media) content.push({type: 'image', value: media.data, media_type: media.mimetype});
        if (isImage && !media) content.push({type: 'text', value: '<Unprocessed image>'});
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
        c.type === 'audio' && c.value === '<Transcribing voice message...>' ? {type: 'audio', value: transcription} : c
      );
    });

    let systemPrompt = CONFIG.getSystemPrompt();
    let botName = this.botConfig.botName;

    const chatConfiguration = chatConfigurationManager.getChatConfig(chatData.id._serialized);
    if (chatConfiguration) {
      botName = chatConfiguration.botName || this.botConfig.botName;
      systemPrompt = CONFIG.getSystemPrompt(chatConfiguration.promptInfo, botName);
      logger.debug(`Using custom configuration for ${chatConfiguration.isGroup ? 'group' : 'chat'} "${chatConfiguration.name}" with bot name "${botName}": ${systemPrompt}`);
    }

    // Send the message and return the text response
    if (AIConfig.ChatConfig.provider == AIProvider.CLAUDE) {
      const convertedMessageList: MessageParam[] = this.convertIaMessagesLang(messageList.reverse(), AIProvider.CLAUDE) as MessageParam[];
      return await this.claudeService.sendChat(convertedMessageList, CONFIG.getSystemPrompt());
    } else {
      const convertedMessageList: ChatCompletionMessageParam[] = this.convertIaMessagesLang(messageList.reverse(), AIConfig.ChatConfig.provider as AIProvider, systemPrompt) as ChatCompletionMessageParam[];
      return await this.openAIService.sendCompletion(convertedMessageList);
    }
  }

  /**
   * Generates and sends an audio message by synthesizing speech from provided text.
   *
   * This function converts text to speech using either:
   * - OpenAI's text-to-speech API
   * - ElevenLabs' text-to-speech service
   *
   * If no explicit content is provided, it attempts to use the last message sent by the bot
   * as input for speech synthesis. The resulting audio is sent as a voice message.
   *
   * @param message - The Message object for reply context
   * @param chatData - The Chat object for the conversation
   * @param content - Optional text content to convert to speech
   * @param responseFormat - Optional format for the audio response
   * @returns A promise that resolves when the audio message is sent
   */
  private async speak(message: Message, chatData: Chat, content: string | undefined, responseFormat?) {
    // Set the content to be spoken. If no content is explicitly provided, fetch the last bot reply for use.
    let messageToSay = content || await this.getLastBotMessage(chatData);
    try {
      // Generate speech audio from the given text content using the OpenAI API.

      let base64Audio;
      if (AIConfig.SpeechConfig.provider == AIProvider.ELEVENLABS) {
        base64Audio = await elevenTTS(messageToSay);
      } else {
        const audioBuffer = await this.openAIService.speech(messageToSay, responseFormat);
        base64Audio = audioBuffer.toString('base64');
      }

      let audioMedia = new MessageMedia('audio/mp3', base64Audio, 'voice.mp3');

      // Reply to the message with the synthesized speech audio.
      const repliedMsg = await message.reply(audioMedia, undefined, {sendAudioAsVoice: true});

      this.cache.set(repliedMsg.id._serialized, messageToSay, CONFIG.botConfig.nodeCacheTime);
    } catch (e: any) {
      logger.error(`Error in speak function: ${e.message}`);
      throw e;
    }
  }

  /**
   * Creates and sends an AI-generated image in response to a text prompt.
   *
   * This function uses OpenAI's DALL-E model to generate an image based on
   * the provided text prompt. The resulting image is sent as a reply to the
   * original message.
   *
   * @param message - The Message object for reply context
   * @param content - The text prompt for image generation
   * @returns A promise that resolves when the image is sent
   */
  private async createImage(message: Message, content: string | undefined) {
    // Verify that content is provided for image generation, return if not.
    if (!content) return;

    try {
      // Calls the ChatGPT service to generate an image based on the provided textual content.
      const imgResponse = await this.openAIService.createImage(content);
      let media;
      if (imgResponse[0].url) {
        media = await MessageMedia.fromUrl(imgResponse[0].url);
      } else if (imgResponse[0].b64_json) {
        media = new MessageMedia('image/png', imgResponse[0].b64_json);
      }

      // Reply to the message with the generated image.
      return await message.reply(media);
    } catch (e: any) {
      logger.error(`Error in createImage function: ${e.message}`);
      // In case of an error during image generation or sending the image, inform the user.
      return message.reply("I encountered a problem while trying to generate an image, please try again.");
    }
  }

  /**
   * Retrieves the last message sent by the bot in a chat.
   *
   * This function fetches recent messages from the chat history and
   * finds the most recent message sent by the bot (fromMe = true)
   * that contains substantive content.
   *
   * @param chatData - The Chat object to search for messages
   * @returns A promise resolving to the text of the last bot message
   */
  private async getLastBotMessage(chatData: Chat) {
    const lastMessages = await chatData.fetchMessages({limit: 12});
    let lastMessageBot: string = '';
    for (const msg of lastMessages) {
      if (msg.fromMe && msg.body.length > 1) lastMessageBot = msg.body;
    }
    return lastMessageBot;
  }

  /**
   * Converts AI message structures between different language model formats.
   *
   * This function transforms message arrays into formats compatible with various AI providers:
   * - OpenAI: Structured with system, user and assistant roles
   * - Claude: Requires alternating user/assistant roles with specific content formats
   * - Qwen: Similar to OpenAI but with provider-specific adaptations
   * - DeepSeek: Uses JSON formatting with text blocks
   * - DeepInfra/Custom: Uses simplified message formatting
   *
   * The function handles text, audio transcriptions, and images appropriately for each provider.
   *
   * @param messageList - Array of AI messages to convert
   * @param lang - The target AI provider format
   * @param systemPrompt - Optional system prompt to include
   * @returns Formatted message array compatible with the specified AI provider
   */
  private convertIaMessagesLang(messageList: AiMessage[], lang: AIProvider, systemPrompt?: string): MessageParam[] | ChatCompletionMessageParam[] {
    switch (lang) {
      case AIProvider.CLAUDE:

        const claudeMessageList: MessageParam[] = [];
        let currentRole: AIRole = AIRole.USER;
        let gptContent: Array<TextBlock | ImageBlockParam> = [];
        messageList.forEach((msg, index) => {
          const role = msg.role === AIRole.ASSISTANT && msg.content.find(c => c.type === 'image') ? AIRole.USER : msg.role;
          if (role !== currentRole) { // Change role or if it's the last message
            if (gptContent.length > 0) {
              claudeMessageList.push({role: currentRole as any, content: gptContent});
              gptContent = []; // Reset for the next block of messages
            }
            currentRole = role; // Ensure role alternation 
          }

          // Add content to the current block
          msg.content.forEach(c => {
            if (['text', 'audio'].includes(c.type)) gptContent.push({
              type: 'text',
              text: JSON.stringify({message: c.value, author: msg.name, type: c.type})
            });
            if (['image'].includes(c.type)) gptContent.push({
              type: 'image',
              source: {data: c.value!, media_type: c.media_type as any, type: 'base64'}
            });
          });
        });
        // Ensure the last block is not left out
        if (gptContent.length > 0) claudeMessageList.push({role: currentRole, content: gptContent});

        // Ensure the first message is always AiRole.USER (by API requirement)
        if (claudeMessageList.length > 0 && claudeMessageList[0].role !== AIRole.USER) {
          claudeMessageList.shift(); // Remove the first element if it's not USER
        }

        return claudeMessageList;

      case AIProvider.DEEPSEEK:

        const deepSeekMsgList: any[] = [];
        messageList.forEach(msg => {
          if (msg.role == AIRole.ASSISTANT) {
            const textContent = msg.content.find(c => ['text', 'audio'].includes(c.type))!;
            const content = JSON.stringify({
              type: 'text',
              text: JSON.stringify({message: textContent.value, author: msg.name, type: textContent.type, response_format: "json_object"})
            });
            deepSeekMsgList.push({content: content, name: msg.name!, role: msg.role});
          } else {
            const gptContent: Array<any> = [];
            msg.content.forEach(c => {
              if (['image'].includes(c.type)) gptContent.push({
                type: 'text',
                text: JSON.stringify({message: getUnsupportedMessage('image', ''), author: msg.name, type: c.type, response_format: "json_object"})
              });
              if (['text', 'audio'].includes(c.type)) gptContent.push({
                type: 'text',
                text: JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format: "json_object"})
              });
            })
            deepSeekMsgList.push({content: gptContent, name: msg.name!, role: msg.role});
          }
        })

        deepSeekMsgList.unshift({role: AIRole.SYSTEM, content: [{type: 'text', text: systemPrompt}]});

        return deepSeekMsgList;

      case AIProvider.OPENAI:
      case AIProvider.QWEN:
        const chatgptMessageList: any[] = [];
        messageList.forEach(msg => {
          const gptContent: Array<any> = [];
          msg.content.forEach(c => {
            if (['text', 'audio'].includes(c.type)) gptContent.push({
              type: 'text',
              text: JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format: 'json_object'})
            });
            if (['image'].includes(c.type)) gptContent.push({type: 'image_url', image_url: {url: `data:${c.media_type};base64,${c.value}`}});
          })
          chatgptMessageList.push({content: gptContent, name: msg.name!, role: msg.role});
        })

        chatgptMessageList.unshift({role: AIRole.SYSTEM, content: [{type: 'text', text: systemPrompt}]});

        return chatgptMessageList;

      case AIProvider.CUSTOM:
      case AIProvider.DEEPINFRA:

        const otherMsgList: any[] = [];
        messageList.forEach(msg => {
          if (msg.role == AIRole.ASSISTANT) {
            const textContent = msg.content.find(c => ['text', 'audio'].includes(c.type))!;
            const content = JSON.stringify({message: textContent.value, author: msg.name, type: textContent.type, response_format: "json_object"});
            otherMsgList.push({content: content, name: msg.name!, role: msg.role});
          } else {
            const gptContent: Array<any> = [];
            msg.content.forEach(c => {
              if (['image'].includes(c.type)) gptContent.push(JSON.stringify({message: getUnsupportedMessage('image', ''), author: msg.name, type: c.type, response_format: "json_object"}));
              if (['text', 'audio'].includes(c.type)) gptContent.push(JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format: "json_object"}));
            })
            otherMsgList.push({content: gptContent[0], role: msg.role});
          }
        })

        otherMsgList.unshift({role: AIRole.SYSTEM, content: systemPrompt});

        return otherMsgList;

      default:
        return [];
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

        const existingConfig = chatConfigurationManager.getChatConfig(chat.id._serialized);

        const updateOptions: any = {
          promptInfo: existingConfig?.promptInfo || CONFIG.botConfig.promptInfo,
          botName: existingConfig?.botName
        };

        if (subCommand === 'prompt') updateOptions.promptInfo = value;
        else updateOptions.botName = value;

        const updatedConfig = chatConfigurationManager.updateChatConfig(
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
        const currentConfig = chatConfigurationManager.getChatConfig(chat.id._serialized);
        if (!currentConfig) return message.reply(`This ${isGroup ? 'group' : 'chat'} does not have a custom configuration.`);

        let response = currentConfig.promptInfo? `Current personality: ${currentConfig.promptInfo}`:``;
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
   * Transcribes a voice message to text using AI services.
   *
   * This function:
   * 1. Checks if the transcription already exists in cache
   * 2. Converts the media to an audio buffer and stream
   * 3. Sends the audio to the configured transcription service
   * 4. Caches the result for future use
   *
   * The function uses the OpenAI service which may route to different
   * providers based on configuration.
   *
   * @param media - The MessageMedia object containing the voice data
   * @param message - The Message object for cache identification
   * @returns A promise resolving to the transcribed text
   */
  private async transcribeVoice(media: MessageMedia, message: Message): Promise<string> {
    try {

      // Check if the transcription exists in the cache
      const cachedMessage = this.getCachedMessage(message);
      if (cachedMessage) return cachedMessage;

      // Convert the base64 media data to a Buffer
      const audioBuffer = Buffer.from(media.data, 'base64');

      // Convert the buffer to a stream
      const audioStream = bufferToStream(audioBuffer);

      logger.debug(`[${AIConfig.TranscriptionConfig.provider}->transcribeVoice] Starting audio transcription`);

      const transcribedText = await this.openAIService.transcription(audioStream);

      // Log the transcribed text
      logger.debug(`[${AIConfig.TranscriptionConfig.provider}->transcribeVoice] Transcribed text: ${transcribedText}`);

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
   * Sends a response message appropriately based on chat context.
   *
   * This function handles the difference between group chats and direct messages:
   * - In groups: Replies to the original message, creating a thread
   * - In direct chats: Sends a new message to the chat
   *
   * @param message - The original Message object to reply to
   * @param responseMsg - The text content to send
   * @param isGroup - Boolean indicating if this is a group chat
   * @param client - The WhatsApp client instance
   * @returns A promise resolving to the sent message
   */
  private returnResponse(message, responseMsg, isGroup, client) {
    if (isGroup) return message.reply(responseMsg);
    else return client.sendMessage(message.from, responseMsg);
  }

  /**
   * Retrieves a cached message by its unique identifier.
   *
   * This function checks the NodeCache instance for previously stored
   * message content, such as transcriptions or generated responses.
   *
   * @param msg - The Message object whose content might be cached
   * @returns The cached string content or undefined if not found
   */
  private getCachedMessage(msg: Message) {
    return this.cache.get<string>(msg.id._serialized);
  }

}
