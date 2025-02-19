import { OpenaiService } from './services/openai-service';
import { Chat, Client, Message, MessageMedia, MessageTypes } from 'whatsapp-web.js';
import { bufferToStream, getContactName, getUnsupportedMessage, includeName, logMessage, parseCommand } from './utils';
import logger from './logger';
import { CONFIG } from './config';
import { AiAnswer, AiContent, AiLanguage, AiMessage, AiRole } from './interfaces/ai-message';
import Anthropic from '@anthropic-ai/sdk';
import { ChatCompletionMessageParam } from 'openai/resources';
import { AnthropicService } from './services/anthropic-service';
import { ImageBlockParam, TextBlock } from '@anthropic-ai/sdk/src/resources/messages';
import NodeCache from 'node-cache';
import MessageParam = Anthropic.MessageParam;

export class Roboto {

  private openAIService: OpenaiService;
  private claudeService: AnthropicService;
  private botConfig = CONFIG.botConfig;
  private allowedTypes = [MessageTypes.STICKER, MessageTypes.TEXT, MessageTypes.IMAGE, MessageTypes.VOICE, MessageTypes.AUDIO];
  private cache: NodeCache;
  private groupProcessingStatus: {[key: string]: boolean} = {};

  public constructor() {

    this.openAIService = new OpenaiService();
    this.claudeService = new AnthropicService();
    this.cache = new NodeCache();
  }

  /**
   * Handles incoming WhatsApp messages and decides the appropriate action.
   * This can include parsing commands, replying to direct mentions or messages, or sending responses through the ChatGPT AI.
   *
   * The function first checks for the type of message and whether it qualifies for a response based on certain criteria,
   * such as being a broadcast message, a direct mention, or containing a specific command.
   *
   * If the message includes a recognized command, the function dispatches the message for command-specific handling.
   * Otherwise, it constructs a prompt for the ChatGPT AI based on recent chat messages and sends a response back to the user.
   *
   * The function supports special actions like generating images or synthesizing speech based on the content of the message.
   *
   * Parameters:
   * - message: The incoming Message object from the WhatsApp Web.js library that encapsulates all data and operations relevant to the received WhatsApp message.
   *
   * Returns:
   * - A promise that resolves to a boolean value indicating whether a response was successfully sent back to the user or not.
   */
  public async readMessage(message: Message, client: Client) {

    const chatData: Chat = await message.getChat();

    try {

      // Extract the data input (extracts command e.g., "-a", and the message)
      const isAudioMsg = message.type == MessageTypes.VOICE || message.type == MessageTypes.AUDIO;
      const { command, commandMessage } = parseCommand(message.body);

      // If it's a "Broadcast" message, it's not processed
      if(chatData.id.user == 'status' || chatData.id._serialized == 'status@broadcast') return false;

      // Evaluates whether the message type will be processed
      if(!this.allowedTypes.includes(message.type) || (isAudioMsg && !this.botConfig.voiceMessagesEnabled)) return false;

      // Evaluates if it should respond
      const isSelfMention = message.hasQuotedMsg ? (await message.getQuotedMessage()).fromMe : false;
      const isMentioned = includeName(message.body, this.botConfig.botName);

      if(!isSelfMention && !isMentioned && !command && chatData.isGroup) return false;

      // Logs the message
      logMessage(message, chatData);

      // Evaluates if it should go to the command flow
      if(!!command){
        await chatData.sendStateTyping();
        await this.commandSelect(message);
        await chatData.clearState();
        return true;
      }

      while (this.groupProcessingStatus[chatData.id._serialized]) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Espera 3 segundos
      }
      this.groupProcessingStatus[chatData.id._serialized] = true;

      // Sends message to ChatGPT
      chatData.sendStateTyping();
      let chatResponseString : AiAnswer = await this.processMessage(chatData);
      chatData.clearState();

      if(!chatResponseString) return;

      // Evaluate if response message must be Audio or Text
      if (chatResponseString.type.toLowerCase() == 'audio' && CONFIG.botConfig.voiceMessagesEnabled) {
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
   * Selects and executes an action based on the recognized command in a received message.
   * This function is a command dispatcher that interprets the command (if any) present
   * in the user's message and triggers the corresponding functionality, such as creating
   * images or generating speech.
   *
   * Supported commands include generating images (`image`) or text-to-speech synthesis (`speak`).
   * The function relies on the presence of a command parsed from the message body to determine
   * the appropriate action. If a supported command is found, the function executes the associated
   * method and handles tasks like generating an image based on the provided textual content
   * or creating an audio file from text.
   *
   * Parameters:
   * - message: The Message object received from WhatsApp, which includes the command and any
   *   additional message content intended for processing.
   * - chatData: The Chat object associated with the received message, providing context such
   *   as the chat's identity and state.
   *
   * Returns:
   * - A promise that resolves to `true` if an action for a recognized command is successfully
   *   initiated, or `void` if no recognized command is found or the command functionality is
   *   disabled through the bot's configuration.
   */
  private async commandSelect(message: Message) {
    const { command, commandMessage } = parseCommand(message.body);
    switch (command) {
      case "image":
        if (!this.botConfig.imageCreationEnabled) return;
        return await this.createImage(message, commandMessage);
      case "reset":
        return await message.react('👍');
      default:
        return true;
    }
  }

  /**
   * Processes an incoming message and generates an appropriate response using the configured AI language model.
   *
   * This function is responsible for constructing the context for the selected AI model based on recent chat messages,
   * subject to certain limits and filters. It then sends the context to the configured AI language model
   * (OpenAI, Claude, QWEN, DEEPSEEK or CUSTOM) to generate a response.
   *
   * The function handles various aspects of the conversation, such as:
   * - Filtering out messages older than a specified time limit
   * - Limiting the number of messages and tokens sent to the AI model
   * - Handling image and audio messages (requires OpenAI API key)
   * - Including them in the context if applicable
   * - Resetting the conversation context if the "-reset" command is encountered
   *
   * @param chatData - The Chat object representing the conversation context.
   * @returns A promise that resolves with the generated response string, or null if no response is needed.
   */
  private async processMessage(chatData: Chat) {

    const actualDate = new Date();

    // Initialize an array of messages
    const messageList: AiMessage[] = [];

    // Placeholder for promises for transcriptions - Image Counting
    let transcriptionPromises: { index: number, promise: Promise<string> }[] = [];
    let imageCount: number = 0;

    // Retrieve the last 'limit' number of messages to send them in order
    const fetchedMessages = await chatData.fetchMessages({ limit: this.botConfig.maxMsgsLimit });
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
        const media = (isImage && imageCount < this.botConfig.maxImages) || (isAudio && !cachedMessage) ?
          await msg.downloadMedia() : null;

        if (media && isImage) imageCount++;

        const role = (!msg.fromMe || isImage) ? AiRole.USER : AiRole.ASSISTANT;
        const name = msg.fromMe ? (CONFIG.botConfig.botName) : (await getContactName(msg));

        // Assemble the content as a mix of text and any included media
        const content: Array<AiContent> = [];
        if (isOther || (isAudio && !this.botConfig.voiceMessagesEnabled))
          content.push({type: 'text', value: getUnsupportedMessage(msg.type, msg.body)});
        else if (isAudio && media && !cachedMessage) {
          transcriptionPromises.push({index: messageList.length, promise: this.transcribeVoice(media, msg)});
          content.push({type: 'audio', value: '<Transcribing voice message...>'});
        }
        if (isAudio && cachedMessage) content.push({type: 'audio', value: cachedMessage});
        if (isImage && media)         content.push({type: 'image', value: media.data, media_type: media.mimetype});
        if (isImage && !media)        content.push({type: 'text', value: '<Unprocessed image>'});
        if (msg.body && !isOther)     content.push({type: 'text', value: msg.body});

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
        c.type === 'audio' && c.value === '<Transcribing voice message...>' ? { type: 'audio', value: transcription }: c
      );
    });

    // Send the message and return the text response
    if (CONFIG.botConfig.aiLanguage == AiLanguage.CLAUDE) {
      const convertedMessageList: MessageParam[] = this.convertIaMessagesLang(messageList.reverse(), AiLanguage.CLAUDE) as MessageParam[];
      return await this.claudeService.sendChat(convertedMessageList, this.botConfig.prompt);
    }else{
      const convertedMessageList: ChatCompletionMessageParam[] = this.convertIaMessagesLang(messageList.reverse(), CONFIG.botConfig.aiLanguage as AiLanguage) as ChatCompletionMessageParam[];
      return await this.openAIService.sendCompletion(convertedMessageList, this.botConfig.prompt);
    }
  }

  /**
   * Generates and sends an audio message by synthesizing speech from the provided text content.
   * This function requires a valid OpenAI API key regardless of the AI model selected for chat.
   * If no content is explicitly provided, the function attempts to use the last message sent by the bot
   * as the text input for speech synthesis.
   *
   * Parameters:
   * - message: The Message object received from WhatsApp for reply context.
   * - chatData: The Chat object associated with the received message.
   * - content: Optional text content to be converted into speech.
   * - responseFormat: Optional format specification for the audio response.
   *
   * Returns:
   * - A promise that resolves when the audio message has been successfully sent.
   */
  private async speak(message: Message, chatData: Chat, content: string | undefined, responseFormat?) {
    // Set the content to be spoken. If no content is explicitly provided, fetch the last bot reply for use.
    let messageToSay = content || await this.getLastBotMessage(chatData);
    try {
      // Generate speech audio from the given text content using the OpenAI API.
      const audioBuffer = await this.openAIService.speech(messageToSay, responseFormat);
      const base64Audio = audioBuffer.toString('base64');

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
   * Creates and sends an image in response to a message, based on provided textual content.
   * This function requires a valid OpenAI API key regardless of the AI model selected for chat.
   * The function calls OpenAI's DALL-E API to generate an image using the provided text as a prompt.
   *
   * Parameters:
   * - message: The Message object received from WhatsApp for reply context.
   * - content: The text content that will serve as a prompt for image generation.
   *
   * Returns:
   * - A promise that resolves when the image has been successfully generated and sent.
   */
  private async createImage(message: Message, content: string | undefined) {
    // Verify that content is provided for image generation, return if not.
    if (!content) return;

    try {
      // Calls the ChatGPT service to generate an image based on the provided textual content.
      const imgUrl = await this.openAIService.createImage(content) as string;
      const media = await MessageMedia.fromUrl(imgUrl);

      // Reply to the message with the generated image.
      return await message.reply(media);
    } catch (e: any) {
      logger.error(`Error in createImage function: ${e.message}`);
      // In case of an error during image generation or sending the image, inform the user.
      return message.reply("I encountered a problem while trying to generate an image, please try again.");
    }
  }

  private async getLastBotMessage(chatData: Chat) {
    const lastMessages = await chatData.fetchMessages({limit: 12});
    let lastMessageBot: string = '';
    for (const msg of lastMessages) {
      if(msg.fromMe && msg.body.length>1) lastMessageBot = msg.body;
    }
    return lastMessageBot;
  }

  /**
   * Converts AI message structures between different language models (OPENAI, CLAUDE, QWEN, DEEPSEEK and CUSTOM).
   * This function takes a list of AI messages, which may include text and image content,
   * and converts this list into a format compatible with the specified AI language model.
   * It supports conversion to both OpenAI-compatible formats and Claude's specific format.
   *
   * Parameters:
   * - messageList: An array of AiMessage, representing the messages to be converted.
   * - lang: An AiLanguage enum value indicating the target language model (OPENAI, CLAUDE, QWEN, DEEPSEEK or CUSTOM).
   *
   * Returns:
   * - An array of MessageParam (for CLAUDE) or ChatCompletionMessageParam (for OpenAI-compatible services),
   *   formatted according to the specified language model's requirements.
   */
  private convertIaMessagesLang(messageList: AiMessage[], lang: AiLanguage ): MessageParam[] | ChatCompletionMessageParam[]{
    switch (lang){
      case AiLanguage.CLAUDE:

        const claudeMessageList: MessageParam[] = [];
        let currentRole: AiRole = AiRole.USER;
        let gptContent: Array<TextBlock | ImageBlockParam> = [];
        messageList.forEach((msg, index) => {
          const role = msg.role === AiRole.ASSISTANT && msg.content.find(c => c.type === 'image') ? AiRole.USER : msg.role;
          if (role !== currentRole) { // Change role or if it's the last message
            if (gptContent.length > 0) {
              claudeMessageList.push({ role: currentRole, content: gptContent });
              gptContent = []; // Reset for the next block of messages
            }
            currentRole = role; // Ensure role alternation 
          }

          // Add content to the current block
          msg.content.forEach(c => {
            if (['text', 'audio'].includes(c.type))  gptContent.push({ type: 'text', text: JSON.stringify({message: c.value, author: msg.name, type: c.type})});
            if (['image'].includes(c.type))          gptContent.push({ type: 'image', source: { data: c.value!, media_type: c.media_type as any, type: 'base64' } });
          });
        });
        // Ensure the last block is not left out
        if (gptContent.length > 0) claudeMessageList.push({ role: currentRole, content: gptContent });

        // Ensure the first message is always AiRole.USER (by API requirement)
        if (claudeMessageList.length > 0 && claudeMessageList[0].role !== AiRole.USER) {
          claudeMessageList.shift(); // Remove the first element if it's not USER
        }

        return claudeMessageList;

      case AiLanguage.DEEPSEEK:

        const deepSeekMsgList: any[] = [];
        messageList.forEach(msg => {
          if(msg.role == AiRole.ASSISTANT) {
            const textContent = msg.content.find(c => c.type === 'text')!;
            const content = JSON.stringify({ type: 'text', text: JSON.stringify({message: textContent.value, author: msg.name, type: textContent.type, response_format: "json_object"}) });
            deepSeekMsgList.push({content: content, name: msg.name!, role: msg.role});
          }
          else {
            const gptContent: Array<any> = [];
            msg.content.forEach(c => {
              if (['image'].includes(c.type)) gptContent.push({type: 'text', text: JSON.stringify({message: getUnsupportedMessage('image', ''), author: msg.name, type: c.type, response_format: "json_object"})});
              if (['text', 'audio'].includes(c.type)) gptContent.push({type: 'text', text: JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format: "json_object"})});
            })
            deepSeekMsgList.push({content: gptContent, name: msg.name!, role: msg.role});
          }
        })
        return deepSeekMsgList;

      case AiLanguage.OPENAI:
      case AiLanguage.QWEN:
      case AiLanguage.CUSTOM:

        const chatgptMessageList: any[] = [];
        messageList.forEach(msg => {
          const gptContent: Array<any> = [];
          msg.content.forEach(c => {
            if (['text', 'audio'].includes(c.type))  gptContent.push({ type: 'text', text: JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format:'json_object'}) });
            if (['image'].includes(c.type))          gptContent.push({ type: 'image_url', image_url: { url: `data:${c.media_type};base64,${c.value}`} });
          })
          chatgptMessageList.push({content: gptContent, name: msg.name!, role: msg.role});
        })
        return chatgptMessageList;

      default:
        return [];
    }
  }

  /**
   * Transcribes a voice message by converting it to audio and then using the configured AI service.
   * If the transcription for the message exists in the cache, it will return the cached value.
   *

   * This function performs the following steps:
   * - Checks the cache for existing transcription.
   * - Converts the base64 media data into an audio buffer.
   * - Converts the buffer to a stream and sends it for transcription.
   * - Stores the transcription result in the cache.     *

   * @param media - The media object containing the voice message data.
   * @param message - The Message object received from WhatsApp.
   * @returns A promise that resolves to the transcribed text of the voice message.
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

      logger.debug(`[ChatGTP->transcribeVoice] Starting audio transcription`);

      const transcribedText = await this.openAIService.transcription(audioStream);

      // Log the transcribed text
      logger.debug(`[ChatGTP->transcribeVoice] Transcribed text: ${transcribedText}`);

      // Store in cache
      this.cache.set(message.id._serialized, transcribedText, CONFIG.botConfig.nodeCacheTime);

      return transcribedText;

    } catch (error: any) {
      // Error handling
      logger.error(`Error transcribing voice message: ${error.message}`);
      return '<Error transcribing voice message>';
    }
  }

  private returnResponse(message, responseMsg, isGroup, client){
    if(isGroup) return message.reply(responseMsg);
    else return client.sendMessage(message.from, responseMsg);
  }

  private getCachedMessage(msg: Message){
    return this.cache.get<string>(msg.id._serialized);
  }

}
