import { OpenaiService } from './services/openai-service';
import { Chat, Client, GroupChat, Message, MessageMedia, MessageTypes } from 'whatsapp-web.js';
import { extractAnswer, includeName, logMessage, parseCommand } from './utils';
import logger from './logger';
import { AIConfig, CONFIG } from './config';
import { AIAnswer, AiMessage, AIProvider } from './interfaces/ai-interfaces';
import { ChatCompletionMessageParam } from 'openai/resources';
import { AnthropicService } from './services/anthropic-service';
import { MessageParam } from '@anthropic-ai/sdk/src/resources/messages';
import { elevenTTS } from './services/elevenlabs-service';
import { chatConfigurationManager } from './config/chat-configurations';
import { ResponseInput } from "openai/resources/responses/responses";
import { AITools } from "./config/functions";
import { MessageHandler } from "./message-handler";

export class Roboto {

  private _openAIService: OpenaiService;
  private claudeService: AnthropicService;
  private messageHandler: MessageHandler;
  private allowedTypes = [MessageTypes.STICKER, MessageTypes.TEXT, MessageTypes.IMAGE, MessageTypes.VOICE, MessageTypes.AUDIO];
  private groupProcessingStatus: { [key: string]: boolean } = {};

  public constructor() {

    this._openAIService = new OpenaiService();
    this.claudeService = new AnthropicService();
    this.messageHandler = new MessageHandler();
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

      // Bot System prompt and name
      const chatConfiguration = chatConfigurationManager.getChatConfig(chatData.id._serialized);
      let botName = chatConfiguration?.botName || CONFIG.botConfig.botName;
      let systemPrompt = chatConfiguration? CONFIG.getSystemPrompt(chatConfiguration.promptInfo, botName) : CONFIG.getSystemPrompt();

      // Evaluates if it should respond
      const isSelfMention = message.hasQuotedMsg ? (await message.getQuotedMessage()).fromMe : false;
      const isMentioned = includeName(message.body, botName);

      if (!isSelfMention && !isMentioned && !command && chatData.isGroup) return false;

      while (this.groupProcessingStatus[chatData.id._serialized]) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      this.groupProcessingStatus[chatData.id._serialized] = true;
      await chatData.sendStateTyping();


      // Logs the message
      logMessage(message, chatData);

      // Evaluates if it should go to the command flow
      if (!!command) {
        await this.commandSelect(message);
        await chatData.clearState();
        return true;
      }

      // Sends message to ChatGPT
      let messagesList: AiMessage[] = await this.messageHandler.createMessageArray(chatData, botName);
      let chatResponseString: string = await this.sendMessagesToAI(messagesList, systemPrompt);
      let chatResponse: AIAnswer = extractAnswer(chatResponseString, botName);

      if (!chatResponse) return false;

      // If the response includes emoji reaction, react to the message
      if(chatResponse.emojiReact)
        message.react(chatResponse.emojiReact);

      // Evaluate if response message must be Audio or Text
      if (chatResponse.type.toLowerCase() == 'audio' && AIConfig.SpeechConfig.enabled) {
        return this.returnAudioResponse(message, chatResponse.message, 'mp3');
      } else {
        return this.returnResponse(message, chatResponse.message, chatData.isGroup, client);
      }

    } catch (e: any) {
      logger.error(e.message);
      return false;
    } finally {
      chatData.clearState();
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

  private async sendMessagesToAI(messageList: AiMessage[], systemPrompt): Promise<string> {
    // Send the message and return the text response
    if (AIConfig.ChatConfig.provider == AIProvider.CLAUDE) {
      const convertedMessageList: MessageParam[] = this.messageHandler.convertIaMessagesLang(messageList.reverse(), AIProvider.CLAUDE) as MessageParam[];
      return await this.claudeService.sendChat(convertedMessageList, CONFIG.getSystemPrompt());
    } else if (AIConfig.ChatConfig.provider == AIProvider.OPENAI) {
      const convertedMessageList: ResponseInput = this.messageHandler.convertIaMessagesLang(messageList.reverse(), AIConfig.ChatConfig.provider as AIProvider, systemPrompt) as ResponseInput;
      return await this._openAIService.sendChatWithTools(convertedMessageList, 'text', AITools);
    } else {
      const convertedMessageList: ChatCompletionMessageParam[] = this.messageHandler.convertIaMessagesLang(messageList.reverse(), AIConfig.ChatConfig.provider as AIProvider, systemPrompt) as ChatCompletionMessageParam[];
      return await this._openAIService.sendCompletion(convertedMessageList);
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
   * @param messageToSay - Text to synthesize
   * @param responseFormat - Optional format for the audio response
   * @returns A promise that resolves when the audio message is sent
   */
  private async returnAudioResponse(message: Message, messageToSay: string | undefined, responseFormat?): Promise<void> {

    try {
      let base64Audio;
      if (AIConfig.SpeechConfig.provider == AIProvider.ELEVENLABS) {
        base64Audio = await elevenTTS(messageToSay);
      } else {
        const audioBuffer = await this._openAIService.speech(messageToSay, responseFormat);
        base64Audio = audioBuffer.toString('base64');
      }

      let audioMedia = new MessageMedia('audio/mp3', base64Audio, 'voice.mp3');

      // Reply to the message with the synthesized speech audio.
      const repliedMsg = await message.reply(audioMedia, undefined, {sendAudioAsVoice: true});

      // Store the message in the cache for future use.
      this.messageHandler.cache.set(repliedMsg.id._serialized, messageToSay, CONFIG.botConfig.nodeCacheTime);

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
      const imgResponse = await this._openAIService.createImage(content);
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

  get openAIService(): OpenaiService {
    return this._openAIService;
  }

}
