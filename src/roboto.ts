import { ChatGTP } from './services/chatgpt';
import { Chat, Message, MessageMedia } from 'whatsapp-web.js';
import { getContactName, includeName, logMessage, parseCommand } from './utils';
import { GPTRol } from './interfaces/gpt-rol';
import logger from './logger';
import { CONFIG } from './config';
import OpenAI from 'openai';
import ChatCompletionContentPart = OpenAI.ChatCompletionContentPart;

export class Roboto {

  private chatGpt: ChatGTP;
  private botConfig = CONFIG.botConfig;

  public constructor() {
    this.chatGpt = new ChatGTP();
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
  public async readMessage(message: Message) {
    try {

      // Extract the data input (extracts command e.g., "-a", and the message)
      const chatData: Chat = await message.getChat();
      const { command, commandMessage } = parseCommand(message.body);

      // If it's a "Broadcast" message, it's not processed
      if(chatData.id.user == 'status' || chatData.id._serialized == 'status@broadcast') return false;

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
      const chatResponseString = await this.chatGPTReply(chatData);
      chatData.clearState();

      if(!chatResponseString) return;
      return message.reply(chatResponseString);
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
      case "speak":
        if (!this.botConfig.audioCreationEnabled) return;
        return await this.speak(message, chatData, commandMessage);
      default:
        return true;
    }
  }

  /**
   * Generates a response to a chat message using the ChatGPT model.
   *
   * This function processes the last set of messages from a chat to form a context,
   * which is then sent to ChatGPT to generate an appropriate response. It includes
   * system-generated prompts that describe the assistant's capabilities and limitations
   * (e.g., memory and character limits) to help guide the chat model's responses.
   *
   * Messages are first filtered to include only recent ones, based on the maximum hours
   * limit defined in the bot configuration. It also limits the number of images processed
   * to the last few images sent, as defined by the bot configuration.
   *
   * The message history and prompt are then sent to the ChatGPT model, which generates
   * a text response. This response is intended to be sent back to the user as a reply
   * to their message.
   *
   * Parameters:
   * - chatData: The Chat object associated with the message, providing context such as
   *   the message history and chat characteristics.
   *
   * Returns:
   * - A promise that resolves to the textual response generated by the ChatGPT model. If there
   *   are no new messages to process, or an error occurs during message processing or API
   *   communication, it may return a string indicating lack of response or the need to try again.
   */
  private async chatGPTReply(chatData: Chat) {

    const actualDate = new Date();

    // Initialize an array of messages
    const messageList: any[] = [];

    // The first element will be the system message
    messageList.push({ role: GPTRol.SYSTEM, content: this.botConfig.prompt });

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

      if ((msg.type !== 'chat' && msg.type !== 'image') || (msg.type === 'chat' && msg.body === '')) continue;

      // Check if the message includes media
      const media = msg.type === 'image' ? await msg.downloadMedia() : null;

      const role = msg.fromMe ? GPTRol.ASSISTANT : GPTRol.USER;
      const name = msg.fromMe ? GPTRol.ASSISTANT : (await getContactName(msg));

      // Assemble the content as a mix of text and any included media
      const content: string | Array<ChatCompletionContentPart> = [];
      if (msg.type === 'image' && media) {
        content.push({
          type: 'image_url', "image_url": {
            "url": `data:image/jpeg;base64,${media.data}`
          }
        });
      }

      if (msg.body) content.push({ type: 'text', text: msg.body });

      messageList.push({ role: role, name: name, content: content });
    }

    // Limit the number of processed images to only the last few, as defined in bot configuration (maxSentImages)
    let imageCount = 0;
    for (let i = messageList.length - 1; i >= 0; i--) {
      if (messageList[i].content.type === 'image_url') {
        imageCount++;
        if (imageCount > this.botConfig.maxImages) messageList.splice(i, 1);
      }
    }

    // If no new messages are present, return without action
    if (messageList.length == 1) return;

    // Send the message and return the text response
    return await this.chatGpt.sendCompletion(messageList);
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
  private async speak(message: Message, chatData: Chat, content: string | undefined) {
    // Set the content to be spoken. If no content is explicitly provided, fetch the last bot reply for use.
    let messageToSay = content || await this.getLastBotMessage(chatData);

    try {
      // Generate speech audio from the given text content using the OpenAI API.
      const audio = await this.chatGpt.speech(messageToSay);
      const audioMedia = new MessageMedia('audio/mp3', audio.toString('base64'), 'response' + '.mp3');

      // Reply to the message with the synthesized speech audio.
      await message.reply(audioMedia);
    } catch (e: any) {
      logger.error(`Error in speak function: ${e.message}`);
      // In case of an error during speech synthesis or sending the audio, inform the user.
      return message.reply("I encountered a problem while trying to generate speech, please try again.");
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

}
