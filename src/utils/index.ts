import logger from '../logger';
import { Chat, Message } from 'whatsapp-web.js';
import { Readable } from 'stream';
import { CONFIG } from '../config';
import { OpenaiAiconfig } from '../interfaces/openai-aiconfig';
import { ChatCompletionMessageParam } from 'openai/resources';
import { AiAnswer } from "../interfaces/ai-message";

export function getFormattedDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');

  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function logMessage(message: Message, chat: Chat) {
  const actualDate = new Date();
  logger.info(
    `{ chatUser:${chat.id.user}, isGroup:${chat.isGroup}, grId:${chat.id._serialized}, grName:${chat.name}, author:'${message.author}', date:'${actualDate.toLocaleDateString()}-${actualDate.toLocaleTimeString()}', msg:'${message.body}' }`
  );
}

export function includeName(bodyMessage: string, name: string): boolean {
  const regex = new RegExp(`(^|\\s)${name}($|[!?.]|\\s|,\\s)`, 'i');
  return regex.test(bodyMessage);
}

export function removeNonAlphanumeric(str: string): string {
  if (!str) return str;
  const regex = /[^a-zA-Z0-9]/g;
  const normalized = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(regex, '');
}

export function parseCommand(input: string): { command?: string, commandMessage?: string } {
  const match = input.match(/^-(\S+)\s*(.*)/);
  if (!match) {
    return {commandMessage: input};
  }
  return {command: match[1].trim(), commandMessage: match[2].trim()};
}

export async function getContactName(message: Message) {
  const contactInfo = await message.getContact();
  const name = contactInfo.shortName || contactInfo.name || contactInfo.pushname || contactInfo.number;
  return removeNonAlphanumeric(name);
}

export function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

export function getUnsupportedMessage(type: string, body?: string) {
  const bodyStr = body ? `, body:"${body}"` : ``;
  const typeStr = `type:"${type}"`;
  return `<Unsupported message: {${typeStr}${bodyStr}}>`
}

export function configValidation() {
  // Validate that the required parameters are defined based on the chosen aiLanguage
  const {botConfig, AIConfigs} = CONFIG;
  const aiLang = botConfig.aiLanguage.toUpperCase();


  if (botConfig.aiLanguage === 'CLAUDE' && !AIConfigs.CLAUDE.apiKey) {
    logger.error("Error: In CLAUDE mode the environment variable CLAUDE_API_KEY must be set. Please provide the required API key in your .env file or environment.");
    process.exit(1);
  }
  if (botConfig.aiLanguage === 'CUSTOM' && (!AIConfigs.CUSTOM.apiKey || !AIConfigs.CUSTOM.baseURL || !AIConfigs.CUSTOM.chatModel)) {
    logger.error("Error: In CUSTOM mode the following environment variables must be set: CUSTOM_API_KEY, CUSTOM_BASEURL, and CUSTOM_COMPLETION_MODEL. Please provide the required configuration in your .env file or environment.");
    process.exit(1);
  }
  if (!AIConfigs[aiLang].apiKey) {
    logger.error(`Error: Using AI: '${aiLang}'. The environment variables ${aiLang}_API_KEY must be set. Please provide the required API key in your .env file or environment.`);
    process.exit(1);
  }

}

export function logConfigInfo() {
  const {botConfig, AIConfigs} = CONFIG;
  const aiCfg: OpenaiAiconfig = AIConfigs[botConfig.aiLanguage];

  if(!AIConfigs.OPENAI.apiKey) {
    logger.warn('The OpenAI API key is not defined in the environment variables. Consequently, the image creation and voice message functionalities will be disabled.');
  }

  if(botConfig.aiLanguage == "OPENAI"){
    logger.info(`${botConfig.aiLanguage} AI mode activated`);
    logger.info(`Chat model: ${CONFIG.AIConfigs.OPENAI.chatModel}`);
  } else if (botConfig.aiLanguage === "CLAUDE") {
    logger.info(`ANTHROPIC AI mode activated`);
    logger.info(`Chat model: ${CONFIG.AIConfigs.CLAUDE.chatModel}`);
  } else {
    logger.info(`${botConfig.aiLanguage} AI mode activated`);
    logger.info(`Chat model: ${aiCfg.chatModel}`);
  }

  logger.info(`[OpenAI] Voice message handling is ${CONFIG.botConfig.voiceMessagesEnabled ? 'enabled' : 'disabled'}.`);
  logger.info(`[OpenAI] Image creation is ${CONFIG.botConfig.imageCreationEnabled ? 'enabled' : 'disabled'}.`);

  if (botConfig.imageCreationEnabled)
    logger.info(`[OpenAI] Image Creation model: ${CONFIG.AIConfigs.OPENAI.imageModel}`);
  if (botConfig.voiceMessagesEnabled) {
    logger.info(`[OpenAI] Transcription model: ${CONFIG.AIConfigs.OPENAI.transcriptionModel}`);
    logger.info(`[OpenAI] Speech model: ${CONFIG.AIConfigs.OPENAI.speechModel}`);
    logger.info(`[OpenAI] Speech voice: ${CONFIG.AIConfigs.OPENAI.speechVoice}`);
  }

}

export function includePrefix(bodyMessage: string, prefix: string): boolean {
  const regex = new RegExp(`(^|\\s)${prefix}($|[!?.]|\\s|,\\s)`, 'i');
  return regex.test(bodyMessage);
}

export function capitalize(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function logGPTMessages(messages: ChatCompletionMessageParam[], quantity: number){
  const msgs = getLastElementsArray(messages, quantity);
  logger.debug(cleanImagesLog(msgs));
}

export function getLastElementsArray<T>(msgs: T[], qty): T[] {
  const array = structuredClone(msgs);
  if (array.length <= qty) return array.slice();
  const inicio = array.length - qty;
  return array.slice(inicio);
}

export function cleanImagesLog(array: ChatCompletionMessageParam[]){
  array.forEach((e:any) => {
    e.content!.forEach((c:any) =>{
      if(c.type == 'image_url') c.image_url.url = '<base64img>';
    })
  });
  return array;
}


export function extractAnswer(input: string, botName: string): AiAnswer {

  const regex = /^<think>[\s\S]*?<\/think>\s*/;
  const inputString = input.replace(regex, '').trim();

  if (!inputString || typeof inputString !== 'string') {
    return null;
  }

  try {
    return JSON.parse(inputString.trim());
  } catch (e) {
  }

  const startMatch = inputString.match(/[{\[]/);
  if (!startMatch) {
    logger.debug("[cleanFileName] Valid JSON start character not found");
    return {message: inputString, author: botName, type: 'text'};
  }

  try {

    const startIndex = startMatch.index;
    let endIndex = inputString.length;
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIndex; i < inputString.length; i++) {
      const char = inputString[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') openBraces++;
      if (char === '}') openBraces--;
      if (char === '[') openBrackets++;
      if (char === ']') openBrackets--;

      if (i >= startIndex && openBraces === 0 && openBrackets === 0) {
        if (startMatch[0] === '{' && char === '}') {
          endIndex = i + 1;
          break;
        }
        if (startMatch[0] === '[' && char === ']') {
          endIndex = i + 1;
          break;
        }
      }
    }

    const jsonString = inputString.substring(startIndex, endIndex);

    return JSON.parse(jsonString);
  } catch (e) {
    return {message: inputString, author: botName, type: 'text' };
  }
}