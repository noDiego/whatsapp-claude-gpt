import { db } from '../db';
import { chatConfigs } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';
import { CONFIG } from './index';

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
        const existing = await db.select().from(chatConfigs).where(eq(chatConfigs.chatId, oldConfig.id)).get();
        if (!existing) {
          await db.insert(chatConfigs).values({
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

  private withDefaults(partial: Partial<ChatConfiguration>, chatId: string): ChatConfiguration {
    const base: ChatConfiguration = {
      chatId,
      name: 'Default Config',
      isGroup: false,
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
    let found = await db.select().from(chatConfigs).where(eq(chatConfigs.chatId, chatId)).get();

    if (!found && chatName) {
      found = await db.select().from(chatConfigs).where(eq(chatConfigs.name, chatName)).get();
    }

    return this.withDefaults(found || {}, chatId);
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
    const current = await db.select().from(chatConfigs).where(eq(chatConfigs.chatId, chatId)).get();

    const merged = this.withDefaults({
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
      await db.update(chatConfigs)
          .set(merged)
          .where(eq(chatConfigs.chatId, chatId))
          .run();
    } else {
      await db.insert(chatConfigs).values(merged).run();
    }
    logger.info(`Updated configuration for ${isGroup ? 'group' : 'chat'} ${chatName} (${chatId})`);
    return merged;
  }

  public async removeChatConfig(chatId: string): Promise<boolean> {
    const result = await db.delete(chatConfigs).where(eq(chatConfigs.chatId, chatId)).run();
    const removed = result.changes > 0;
    if (removed) {
      logger.info(`Removed configuration for chat ${chatId}`);
    }
    return removed;
  }
}

export const chatConfigurationManager = new ChatConfig();