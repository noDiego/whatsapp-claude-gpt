import logger from '../logger';
import { Chat, Message } from 'whatsapp-web.js';
import { Readable } from 'stream';
import { AIConfig, CONFIG } from '../config';
import { AIAnswer } from "../interfaces/ai-interfaces";

export function getFormattedDate(date?: Date) {
  const now = date || new Date();

  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');

  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  const offsetMinutes = now.getTimezoneOffset();
  const offsetSign = offsetMinutes > 0 ? '-' : '+';
  const absOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absOffsetMinutes / 60).toString().padStart(2, '0');
  const offsetMins = (absOffsetMinutes % 60).toString().padStart(2, '0');
  const offsetString = `${offsetSign}${offsetHours}:${offsetMins}`;

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetString}`;
}

export function logMessage(message: Message, chat: Chat) {
  const msgDate = new Date(message.timestamp * 1000);
  logger.info(
    `[ReceivedMessage] {chatUser:${chat.id.user}, isGroup:${chat.isGroup}, grId:${chat.id._serialized}, grName:${chat.name}, date:'${getFormattedDate(msgDate)}', msg:'${message.body}'}`
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

export function extractAnswer(input: string, botName: string): AIAnswer {

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

export function logConfigInfo() {
  logger.info('========== CONFIGURATION SUMMARY ==========');

  // Bot general information
  logger.info(`📝 BOT CONFIGURATION:`);
  logger.info(`• Bot name: ${CONFIG.botConfig.botName}`);
  logger.info(`• Maximum messages considered: ${CONFIG.botConfig.maxMsgsLimit}`);
  logger.info(`• Maximum message age: ${CONFIG.botConfig.maxHoursLimit} hours`);
  logger.info(`• Maximum images processed: ${CONFIG.botConfig.maxImages}`);

  // Chat provider and model
  logger.info(`🤖 CHAT:`);
  logger.info(`• Model: ${AIConfig.chatModel}`);

  // Image configuration
  logger.info(`🖼️ IMAGE GENERATION:`);
  if (AIConfig.imageCreationEnabled) {
    logger.info(`• Status: Enabled`);
    logger.info(`• Model: ${AIConfig.imageModel}`);
  } else {
    logger.info(`• Status: Disabled`);
  }

  // Voice message handling

  // Transcription (Speech-to-Text)
  logger.info(`✍️ TRANSCRIPTION (Speech-to-Text):`);
  logger.info(`  • Model: ${AIConfig.sttModel}`);
  logger.info(`  • Language: ${AIConfig.sttLanguage}`);

  // Speech (Text-to-Speech)
  logger.info(`🔊 SPEECH (Text-to-Speech):`);
  logger.info(`  • Provider: ${AIConfig.ttsProvider}`);
  logger.info(`  • Model: ${AIConfig.ttsModel}`);
  logger.info(`  • Voice: ${AIConfig.ttsVoice}`);

  // Additional information if preferred language is set
  if (CONFIG.botConfig.preferredLanguage) {
    logger.info(`🌐 LANGUAGE PREFERENCES:`);
    logger.info(`• Preferred language: ${CONFIG.botConfig.preferredLanguage}`);
  }

  logger.info('===========================================');
}

export async function isSuperUser(message: Message){
  const contactData = await message.getContact();
  return CONFIG.botConfig.superUserNumbers.includes(contactData.number);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + (weeks * 7));
  return result;
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const currentMonth = result.getMonth();
  const currentYear = result.getFullYear();

  const newMonth = currentMonth + months;
  const yearsToAdd = Math.floor(newMonth / 12);
  const finalMonth = newMonth % 12;

  result.setFullYear(currentYear + yearsToAdd);
  result.setMonth(finalMonth);

  const originalDay = date.getDate();
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();

  if (originalDay > lastDayOfTargetMonth) {
    result.setDate(lastDayOfTargetMonth);
  } else {
    result.setDate(originalDay);
  }

  return result;
}