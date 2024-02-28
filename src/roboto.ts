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

  public async readMessage(message: Message) {
    try {

      /** Se reciben datos de entrada (Se extrae command ej: -a , y se extra mensaje */
      const chatData: Chat = await message.getChat();
      const { command, commandMessage } = parseCommand(message.body);

      /** Si es un mensaje "Broadcast" no se procesa **/
      if(chatData.id.user == 'status' || chatData.id._serialized == 'status@broadcast') return false;

      /** Se evalua si debe responderse */
      const meResponden = message.hasQuotedMsg ? (await message.getQuotedMessage()).fromMe : false;
      const isMentioned = includeName(message.body, this.botConfig.botName);

      if(!meResponden && !isMentioned && !command && chatData.isGroup) return false;

      /** Se guarda Log de mensaje **/
      logMessage(message, chatData);

      /** Se obtiene nombre del contacto */
      const contactInfo = await message.getContact() || message.getInfo;

      /** Se evalua si debe enviar a flujo comandos **/
      if(!!command){
        await chatData.sendStateTyping();
        await this.commandSelect(message, chatData);
        await chatData.clearState();
        return true;
      }

      /** Envia mensaje a ChatGPT */
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

  private async chatGPTReply(chatData: Chat) {

    const actualDate = new Date();

    /**Se arma array de mensajes*/
    const messageList: any[] = [];

    /**Primer elemento será el mensaje de sistema*/
    messageList.push({ role: GPTRol.SYSTEM, content: this.botConfig.prompt });

    /**Se recorren los ultimos 'limit' mensajes para enviarlos en orden */
    const fetchedMessages = await chatData.fetchMessages({ limit: this.botConfig.maxMsgsLimit });
    const resetIndex = fetchedMessages.map(msg => msg.body).lastIndexOf("-reset");
    const messagesToProcess = resetIndex >= 0 ? fetchedMessages.slice(resetIndex + 1) : fetchedMessages;

    for (const msg of messagesToProcess) {

      /** Se valida si el mensaje fue escrito hace menos de 24 horas, si es más antiguo no se considera **/
      const msgDate = new Date(msg.timestamp * 1000);
      const diferenciaHoras = (actualDate.getTime() - msgDate.getTime()) / (1000 * 60 * 60);
      if (diferenciaHoras > this.botConfig.maxHoursLimit) continue;

      if ((msg.type != 'chat' && msg.type != 'image') || msg.body == '') continue;

      /** Se revisa si el mensaje incluye media**/
      const media = msg.type == 'image' ? await msg.downloadMedia() : null;

      const rol = msg.fromMe ? GPTRol.ASSISTANT : GPTRol.USER;
      const name = msg.fromMe ? 'assistant' : (await getContactName(msg));

      const content: string | Array<ChatCompletionContentPart> = [];
      if (msg.type == 'image' && media) {
        content.push({
          type: 'image_url', "image_url": {
            "url": `data:image/jpeg;base64,${media.data}`
          }
        });
      }

      if (msg.body) content.push({ type: 'text', text: msg.body });

      messageList.push({ role: rol, name: name, content: content });
    }

    /** Se recorren los mensajes para limitar la cantidad de imagenes a solo las "maxSentImages" ultimas  */
    let imageCount = 0;
    for (let i = messageList.length - 1; i >= 0; i--) {
      if (messageList[i].content.type === 'image_url') {
        imageCount++;
        if (imageCount > this.botConfig.maxImages) messageList.splice(i, 1);
      }
    }

    /** Si no hay mensajes nuevos retorna sin accion **/
    if (messageList.length == 1) return;

    /** Se envia mensaje y se retorna texto de respuesta */
    return await this.chatGpt.sendCompletion(messageList);
  }

  private async speak(message: Message, chatData: Chat, content: string | undefined) {

    let messageToSay = content || await this.getLastBotMessage(chatData);

    try {
      const audio = await this.chatGpt.speech(messageToSay);
      const audioMedia = new MessageMedia('audio/mp3', audio.toString('base64'), 'test' + '.ogg');
      await message.reply(audioMedia);
    }catch (e: any){
      logger.error(e.message);
      return message.reply(e.message);
    }
  }

  private async createImage(message: Message, content: string | undefined) {

    if (!content) return;

    try {
      const imgUrl = await this.chatGpt.createImage(content) as string;
      const media = await MessageMedia.fromUrl(imgUrl);
      return await message.reply(media);
    }catch (e:any){
      logger.error(e.message);
      return message.reply(e.message);
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
