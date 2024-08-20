import { ChatGTP } from './services/chatgpt';
import { Chat, Client, Message, MessageMedia, MessageTypes } from 'whatsapp-web.js';
import { addNameToMessage, bufferToStream, getContactName, includeName, logMessage, parseCommand } from './utils';
import logger from './logger';
import { CONFIG } from './config';
import { AiContent, AiLanguage, AiMessage, AiRole } from './interfaces/ai-message';
import Anthropic from '@anthropic-ai/sdk';
import { ChatCompletionMessageParam } from 'openai/resources';
import OpenAI from 'openai';
import { Claude } from './services/claude';
import { ImageBlockParam, TextBlock } from '@anthropic-ai/sdk/src/resources/messages';
import MessageParam = Anthropic.MessageParam;
import ChatCompletionContentPart = OpenAI.ChatCompletionContentPart;
import NodeCache from 'node-cache';

export class Roboto {

  private chatGpt: ChatGTP;
  private claude: Claude;
  private botConfig = CONFIG.botConfig;
  private allowedTypes = [MessageTypes.STICKER, MessageTypes.TEXT, MessageTypes.IMAGE, MessageTypes.VOICE, MessageTypes.AUDIO];
  private cache: NodeCache;

  public constructor() {
    this.chatGpt = new ChatGTP();
    this.claude = new Claude();
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
    try {

      // Extract the data input (extracts command e.g., "-a", and the message)
      const chatData: Chat = await message.getChat();
      const { command, commandMessage } = parseCommand(message.body);

      // If it's a "Broadcast" message, it's not processed
      if(chatData.id.user == 'status' || chatData.id._serialized == 'status@broadcast') return false;

      // Evaluates whether the message type will be processed
      if(!this.allowedTypes.includes(message.type)) return false;

      // Evaluates if it should respond
      const isSelfMention = message.hasQuotedMsg ? (await message.getQuotedMessage()).fromMe : false;
      const isMentioned = includeName(message.body, this.botConfig.botName);

      if(!isSelfMention && !isMentioned && !command && chatData.isGroup) return false;

      // Logs the message
      logMessage(message, chatData);

      // Evaluates if it should go to the command flow
      if(!!command){
        await chatData.sendStateTyping();
        await this.commandSelect(message, chatData);
        await chatData.clearState();
        return true;
      }

      // Sends message to ChatGPT
      chatData.sendStateTyping();
      let chatResponseString = await this.processMesage(chatData);
      chatData.clearState();

      if(!chatResponseString) return;

      // Evaluate if response message must be Audio or Text
      if (chatResponseString.startsWith('[Audio]')) {
        chatResponseString = chatResponseString.replace('[Audio]','').trim();
        return this.speak(message, chatData, chatResponseString, 'mp3');
      } else {
        chatResponseString = chatResponseString.replace('[Text]','').trim();
        return this.returnResponse(message, chatResponseString, chatData.isGroup, client);
      }

    } catch (e: any) {
      logger.error(e.message);
      return message.reply('Error 😔');
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
  private async commandSelect(message: Message, chatData: Chat) {
    const { command, commandMessage } = parseCommand(message.body);
    switch (command) {
      case "image":
        if (!this.botConfig.imageCreationEnabled) return;
        return await this.createImage(message, commandMessage);
      default:
        return true;
    }
  }

  /**
   * Processes an incoming message and generates an appropriate response using the configured AI language model.
   *
   * This function is responsible for constructing the context for the AI model based on recent chat messages,
   * subject to certain limits and filters. It then sends the context to the selected AI language model
   * (either OpenAI or Anthropic) to generate a response.
   *
   * The function handles various aspects of the conversation, such as:
   *
   * - Filtering out messages older than a specified time limit.
   * - Limiting the number of messages and tokens sent to the AI model.
   * - Handling image and audio messages, and including them in the context if applicable.
   * - Resetting the conversation context if the "-reset" command is encountered.
   *
   * The generated response is then returned as a string.
   *
   * @param chatData - The Chat object representing the conversation context.
   * @param chatCfg - The ChatCfg object containing configuration settings for the bot's behavior.
   * @returns A promise that resolves with the generated response string, or null if no response is needed.
   */
  private async processMesage(chatData: Chat) {

    const actualDate = new Date();

    // Initialize an array of messages
    const messageList: AiMessage[] = [];

    // Placeholder for promises for transcriptions
    let transcriptionPromises: { index: number, promise: Promise<string> }[] = [];

    // Retrieve the last 'limit' number of messages to send them in order
    const fetchedMessages = await chatData.fetchMessages({ limit: this.botConfig.maxMsgsLimit });
    // Check for "-reset" command in chat history to potentially restart context
    const resetIndex = fetchedMessages.map(msg => msg.body).lastIndexOf("-reset");
    const messagesToProcess = resetIndex >= 0 ? fetchedMessages.slice(resetIndex + 1) : fetchedMessages;

    for (const msg of messagesToProcess) {

      // Validate if the message was written less than 24 (or maxHoursLimit) hours ago; if older, it's not considered
      const msgDate = new Date(msg.timestamp * 1000);
      const timeDifferenceHours = (actualDate.getTime() - msgDate.getTime()) / (1000 * 60 * 60);
      if (timeDifferenceHours > this.botConfig.maxHoursLimit) continue;

      // Check if the message includes media
      const isImage = msg.type === MessageTypes.IMAGE || msg.type ===  MessageTypes.STICKER;
      const isAudio = msg.type === MessageTypes.VOICE || msg.type === MessageTypes.AUDIO;
      if (!this.allowedTypes.includes(msg.type) && !isAudio) continue;
      const media = isImage || isAudio? await msg.downloadMedia() : null;

      const role = msg.fromMe ? AiRole.ASSISTANT : AiRole.USER;
      const name = msg.fromMe ? (CONFIG.botConfig.botName) : (await getContactName(msg));

      // Assemble the content as a mix of text and any included media
      const content: Array<AiContent> = [];
      if (isAudio && media) {
        const transcriptionPromise = this.transcribeVoice(media, msg);
        transcriptionPromises.push({ index: messageList.length, promise: transcriptionPromise });
        content.push({ type: 'text', value: '<Transcribing voice message...>' });
      }
      if (isImage && media) content.push({ type: 'image', value: media.data, media_type: media.mimetype });
      if (msg.body)         content.push({ type: 'text', value: '[Text]' + msg.body });

      messageList.push({ role: role, name: name, content: content });
    }

    // Wait for all transcriptions to complete
    const transcriptions = await Promise.all(transcriptionPromises.map(t => t.promise));
    transcriptionPromises.forEach((transcriptionPromise, idx) => {
      const transcription = transcriptions[idx];
      const messageIdx = transcriptionPromise.index;
      messageList[messageIdx].content = messageList[messageIdx].content.map(c =>
        c.type === 'text' && c.value === '<Transcribing voice message...>' ? { type: 'text', value: transcription }: c
      );
    });

    // Limit the number of processed images to only the last few, as defined in bot configuration (maxSentImages)
    let imageCount = 0;
    for (let i = messageList.length - 1; i >= 0; i--) {
      const haveImg = messageList[i].content.find(c => c.type == 'image');
      if (haveImg) {
        imageCount++;
        if (imageCount > this.botConfig.maxImages) messageList.splice(i, 1);
      }
    }

    // If no new messages are present, return without action
    if (messageList.length == 0) return;

    // Send the message and return the text response
    if (CONFIG.botConfig.aiLanguage == AiLanguage.OPENAI) {
      const convertedMessageList: ChatCompletionMessageParam[] = this.convertIaMessagesLang(messageList, AiLanguage.OPENAI, chatData.isGroup) as ChatCompletionMessageParam[];
      return await this.chatGpt.sendCompletion(convertedMessageList, this.botConfig.prompt);
    } else if (CONFIG.botConfig.aiLanguage == AiLanguage.ANTHROPIC) {
      const convertedMessageList: MessageParam[] = this.convertIaMessagesLang(messageList, AiLanguage.ANTHROPIC, chatData.isGroup) as MessageParam[];
      return await this.claude.sendChat(convertedMessageList, this.botConfig.prompt);
    }
  }

  /**
   * Generates and sends an audio message by synthesizing speech from the provided text content.
   * If no content is explicitly provided, the function attempts to use the last message sent by the bot as the text input for speech synthesis.
   * The generated speech audio is then sent as a reply in the chat.
   *
   * Parameters:
   * - message: The Message object received from WhatsApp. This object contains all the message details and is used to reply with the generated audio.
   * - chatData: The Chat object associated with the received message. This provides context and chat details but is not directly used in this function.
   * - content: The text content to be converted into speech. Optional; if not provided, the function will use the last message sent by the bot.
   *
   * Returns:
   * - A promise that either resolves when the audio message has been successfully sent, or rejects if an error occurs during the process.
   */
  /**
   * Generates and sends an audio message by synthesizing speech from the provided text content.
   * If no content is explicitly provided, the function attempts to use the last message sent by the bot as the text input for speech synthesis.
   * The generated speech audio is then sent as a reply in the chat.
   *
   * Parameters:
   * - message: The Message object received from WhatsApp. This object contains all the message details and is used to reply with the generated audio.
   * - chatData: The Chat object associated with the received message. This provides context and chat details but is not directly used in this function.
   * - content: The text content to be converted into speech. Optional; if not provided, the function will use the last message sent by the bot.
   *
   * Returns:
   * - A promise that either resolves when the audio message has been successfully sent, or rejects if an error occurs during the process.
   */
  private async speak(message: Message, chatData: Chat, content: string | undefined, responseFormat?) {
    // Set the content to be spoken. If no content is explicitly provided, fetch the last bot reply for use.
    let messageToSay = content || await this.getLastBotMessage(chatData);
    try {
      // Generate speech audio from the given text content using the OpenAI API.
      const audioBuffer = await this.chatGpt.speech(messageToSay, responseFormat);
      const base64Audio = audioBuffer.toString('base64');

      let audioMedia = new MessageMedia('audio/mp3', base64Audio, 'voice.mp3');

      // Reply to the message with the synthesized speech audio.
      const repliedMsg = await message.reply(audioMedia, undefined, {sendAudioAsVoice: true});

      this.cache.set(repliedMsg.id._serialized, '[Audio]'+messageToSay, CONFIG.botConfig.nodeCacheTime);
    } catch (e: any) {
      logger.error(`Error in speak function: ${e.message}`);
      throw e;
    }
  }

  /**
   * Creates and sends an image in response to a message, based on provided textual content.
   * The function calls an external API to generate an image using the provided text as a prompt.
   * The resulting image is then sent as a reply in the chat.
   *
   * Parameters:
   * - message: The Message object received from WhatsApp, which contains all the details of the message and is used to reply with the generated image.
   * - content: The text content that will serve as a prompt for the image generation. This content should ideally be descriptive to result in a more accurate image.
   *
   * Returns:
   * - A promise that either resolves when the image has been successfully sent, or rejects if an error occurs during the image generation or sending process.
   */
  private async createImage(message: Message, content: string | undefined) {
    // Verify that content is provided for image generation, return if not.
    if (!content) return;

    try {
      // Calls the ChatGPT service to generate an image based on the provided textual content.
      const imgUrl = await this.chatGpt.createImage(content) as string;
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
   * Converts AI message structures between different language models (OPENAI and ANTHROPIC).
   * This function takes a list of AI messages, which may include text and image content,
   * and converts this list into a format compatible with the specified AI language model.
   * It supports conversion to both OpenAI and Anthropic message formats.
   *
   * Parameters:
   * - messageList: An array of AiMessage, representing the messages to be converted.
   * - lang: An AiLanguage enum value indicating the target language model (OPENAI or ANTHROPIC).
   *
   * Returns:
   * - An array of MessageParam (for Anthropic) or ChatCompletionMessageParam (for OpenAI),
   *   formatted according to the specified language model. The type of array returned depends
   *   on the target language model indicated by the lang parameter.
   */
  private convertIaMessagesLang(messageList: AiMessage[], lang: AiLanguage, isGroup: boolean ): MessageParam[] | ChatCompletionMessageParam[]{
    switch (lang){
      case AiLanguage.ANTHROPIC:

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
            if (c.type === 'text') gptContent.push({ type: 'text', text: isGroup? addNameToMessage(msg.name, c.value) : c.value });
            else if (c.type === 'image') gptContent.push({ type: 'image', source: { data: <string>c.value, media_type: c.media_type as any, type: 'base64' } });
          });
        });
        // Ensure the last block is not left out
        if (gptContent.length > 0) claudeMessageList.push({ role: currentRole, content: gptContent });

        // Ensure the first message is always AiRole.USER (by API requirement)
        if (claudeMessageList.length > 0 && claudeMessageList[0].role !== AiRole.USER) {
          claudeMessageList.shift(); // Remove the first element if it's not USER
        }

        return claudeMessageList;

      case AiLanguage.OPENAI:

        const chatgptMessageList: any[] = [];
        messageList.forEach(msg => {
          const gptContent: Array<ChatCompletionContentPart> = [];
          msg.content.forEach(c => {
            if(c.type == 'image') gptContent.push({ type: 'image_url', image_url: { url: `data:${c.media_type};base64,${c.value}`} });
            if(c.type == 'text') gptContent.push({ type: 'text', text: <string> c.value });
          })
          chatgptMessageList.push({content: gptContent, name: msg.name, role: msg.role});
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
      const cachedMessage = await this.cache.get<string>(message.id._serialized);
      if (cachedMessage) return cachedMessage;

      // Convert the base64 media data to a Buffer
      const audioBuffer = Buffer.from(media.data, 'base64');
      logger.debug(`Created audio buffer with size: ${audioBuffer.length}`);

      // Convert the buffer to a stream
      const audioStream = bufferToStream(audioBuffer);

      logger.debug(`[ChatGTP->transcribeVoice] Starting audio transcription`);

      const transcribedText = await this.chatGpt.transcription(audioStream);

      // Log the transcribed text
      logger.debug(`[ChatGTP->transcribeVoice] Transcribed text: ${transcribedText}`);

      // Append the informative prefix
      const finalMessage = `[Audio]${transcribedText}`;

      // Store in cache
      this.cache.set(message.id._serialized, finalMessage, CONFIG.botConfig.nodeCacheTime);

      return finalMessage;

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

}
