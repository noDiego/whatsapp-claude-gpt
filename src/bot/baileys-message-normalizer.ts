import { getContentType, normalizeMessageContent, type WAMessage } from 'baileys';
import type { WhatsAppMessage, WhatsAppMessageType } from './whatsapp-types';
import { normalizeChatId, normalizeAuthorId, serializeMessageId } from './whatsapp-types';
import { messageStore } from './message-store';

export function normalizeWAMessage(raw: WAMessage): WhatsAppMessage {
  const key = raw.key;
  const chatId = normalizeChatId(key.remoteJid);
  const participantId = key.participant ? normalizeAuthorId(key.participant) : undefined;
  const authorId = normalizeAuthorId(key.participant || key.remoteJid) || chatId;

  const content = normalizeMessageContent(raw.message);
  const contentType = getContentType(content);
  const type = resolveMessageType(content, contentType);
  const body = extractMessageBody(content);

  const contextInfo = contentType ? (content as any)?.[contentType]?.contextInfo : undefined;
  const quotedMsgId = contextInfo?.stanzaId
    ? messageStore.resolveQuotedMessageId(chatId, contextInfo.stanzaId, contextInfo.participant ?? null)
    : undefined;

  const mentionedJids = (contextInfo?.mentionedJid as string[] | undefined)
    ?.map((j: string) => normalizeAuthorId(j))
    .filter((j): j is string => Boolean(j));

  return {
    id: serializeMessageId({
      chatId,
      messageId: key.id!,
      participantId: key.participant ?? undefined,
      fromMe: key.fromMe ?? false,
    }),
    chatId,
    authorId,
    participantId,
    fromMe: !!key.fromMe,
    body,
    timestamp: Number(raw.messageTimestamp ?? 0),
    type,
    hasQuotedMsg: !!contextInfo?.stanzaId,
    quotedMsgId,
    mentionedJids: mentionedJids?.length ? mentionedJids : undefined,
    pushName: raw.pushName ?? undefined,
  };
}

function resolveMessageType(content: any, contentType: string | null | undefined): WhatsAppMessageType {
  switch (contentType) {
    case 'conversation':
    case 'extendedTextMessage':
      return 'chat';
    case 'imageMessage':
      return 'image';
    case 'stickerMessage':
      return 'sticker';
    case 'audioMessage':
      return content?.audioMessage?.ptt ? 'voice' : 'audio';
    case 'documentMessage':
      return 'document';
    default:
      return 'unknown';
  }
}

function extractMessageBody(content: any): string {
  return (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.documentMessage?.caption ??
    ''
  );
}
