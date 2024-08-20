import { Chat, Message } from 'whatsapp-web.js';
import logger from '../logger';
import { Readable } from 'stream';

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

export function logMessage(message: Message, chat: Chat){
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
  if(!str) return str;
  const regex = /[^a-zA-Z0-9]/g;
  const normalized = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(regex, '');
}

export function parseCommand(input: string): { command?: string, commandMessage?: string } {
  const match = input.match(/^-(\S+)\s*(.*)/);
  if (!match) {
    return { commandMessage: input };
  }
  return { command: match[1].trim(), commandMessage: match[2].trim() };
}

export async function getContactName(message: Message){
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

export function addNameToMessage(name, message) {
  // Regex to detect "[Type]"
  const pattern = /^\[.*?\]/;

  // Adding Name
  const modifiedMessage = message.replace(pattern, (match) => {
    return `${match.trim()} ${name}:`;
  });

  return modifiedMessage;
}
