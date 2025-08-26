import { db } from '../db';
import { chatConfigsTable } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';
import { CONFIG } from './index';
import WspWeb from "../bot/wsp-web";

const OLD_CHATCONFIG_FILE = path.join(process.cwd(), 'chat-configurations.json');

export interface ChatConfiguration {
  chatId: string;
  name: string;
  promptInfo: string;
  isGroup: boolean;
  botName?: string;
  maxMsgsLimit?: number;
  maxHoursLimit?: number;
}

class ChatConfig {
  constructor() {
    this.migrateFromJsonIfNeeded();
  }

  private async migrateFromJsonIfNeeded() {

    if (fs.existsSync(OLD_CHATCONFIG_FILE)) {
      logger.info('[ChatConfig] Migrating old JSON data to DB...');
      const jsonConfigs: (Partial<ChatConfiguration> & { id: string })[] = JSON.parse(fs.readFileSync(OLD_CHATCONFIG_FILE, 'utf8'));
      for (const oldConfig of jsonConfigs) {
        const existing = await db.select().from(chatConfigsTable).where(eq(chatConfigsTable.chatId, oldConfig.id)).get();
        if (!existing) {
          await db.insert(chatConfigsTable).values({
            chatId: oldConfig.id,
            name: oldConfig.name,
            promptInfo: oldConfig.promptInfo,
            botName: oldConfig.botName,
            isGroup: oldConfig.isGroup,
            maxMsgsLimit: oldConfig.maxMsgsLimit,
            maxHoursLimit: oldConfig.maxHoursLimit,
          }).run();
        }
      }
      fs.unlinkSync(OLD_CHATCONFIG_FILE);
      logger.info('[ChatConfig] Migration completed and JSON file deleted');
    }
  }

  private async withDefaults(partial: Partial<ChatConfiguration>, chatId: string): Promise<ChatConfiguration> {
    const chat = await WspWeb.getWspClient().getChatById(chatId);
    const base: ChatConfiguration = {
      chatId,
      name: chat.name || '<Unnamed>',
      isGroup: chat.isGroup,
      promptInfo: CONFIG.BotConfig.promptInfo,
      botName: CONFIG.BotConfig.botName,
      maxMsgsLimit: CONFIG.BotConfig.maxMsgsLimit,
      maxHoursLimit: CONFIG.BotConfig.maxHoursLimit,
    };

    const result = { ...base };

    for (const key in partial) {
      const value = partial[key as keyof ChatConfiguration];
      if (value !== null && value !== undefined) {
        (result as any)[key] = value;
      }
    }

    return result;
  }

  public async getChatConfig(chatId: string, chatName: string): Promise<ChatConfiguration> {
    let found = await db.select().from(chatConfigsTable).where(eq(chatConfigsTable.chatId, chatId)).get();

    if (!found && chatName) {
      found = await db.select().from(chatConfigsTable).where(eq(chatConfigsTable.name, chatName)).get();
    }

    return await this.withDefaults(found || {}, chatId);
  }

  public async updateChatConfig(
      chatId: string,
      chatName: string,
      isGroup: boolean,
      options: {
        promptInfo?: string;
        botName?: string;
        maxMsgsLimit?: number;
        maxHoursLimit?: number;
      }
  ): Promise<ChatConfiguration> {
    const current = await db.select().from(chatConfigsTable).where(eq(chatConfigsTable.chatId, chatId)).get();

    const merged = await this.withDefaults({
      ...current,
      chatId: chatId,
      name: chatName,
      isGroup,
      ...(options.promptInfo !== undefined ? { promptInfo: options.promptInfo } : {}),
      ...(options.botName !== undefined ? { botName: options.botName } : {}),
      ...(options.maxMsgsLimit !== undefined ? { maxMsgsLimit: options.maxMsgsLimit } : {}),
      ...(options.maxHoursLimit !== undefined ? { maxHoursLimit: options.maxHoursLimit } : {})
    }, chatId);

    if (current) {
      await db.update(chatConfigsTable)
          .set(merged)
          .where(eq(chatConfigsTable.chatId, chatId))
          .run();
    } else {
      await db.insert(chatConfigsTable).values(merged).run();
    }
    logger.info(`Updated configuration for ${isGroup ? 'group' : 'chat'} ${chatName} (${chatId})`);
    return merged;
  }

  public async removeChatConfig(chatId: string): Promise<boolean> {
    const result = await db.delete(chatConfigsTable).where(eq(chatConfigsTable.chatId, chatId)).run();
    const removed = result.changes > 0;
    if (removed) {
      logger.info(`Removed configuration for chat ${chatId}`);
    }
    return removed;
  }
}

export const chatConfigurationManager = new ChatConfig();