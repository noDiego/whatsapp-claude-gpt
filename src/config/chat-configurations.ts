import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';
import { CONFIG } from './index';

const CHATCONFIG_FILE = path.join(process.cwd(), 'chat-configurations.json');

interface ChatConfiguration {
  id: string;
  name: string;
  promptInfo: string;
  botName?: string;
  isGroup: boolean;
}

class ChatConfig {
  private chatConfigurations: ChatConfiguration[];

  constructor() {
    this.chatConfigurations = [];
    this.loadChatConfigs();
  }

  private loadChatConfigs() {
    try {
      if (fs.existsSync(CHATCONFIG_FILE)) {
        const data = fs.readFileSync(CHATCONFIG_FILE, 'utf8');
        this.chatConfigurations = JSON.parse(data);

        logger.info(`Loaded ${this.chatConfigurations.length} chat configurations`);
      } else {
        logger.info('No chat config file found, creating a new one');
        this.chatConfigurations = [];
        this.saveChatConfig();
      }
    } catch (error: any) {
      logger.error(`Error loading chat configuration: ${error.message}`);
      this.chatConfigurations = [];
      this.saveChatConfig();
    }
  }

  private saveChatConfig() {
    try {
      const data = JSON.stringify(Array.from(this.chatConfigurations), null, 2);
      fs.writeFileSync(CHATCONFIG_FILE, data, 'utf8');
      logger.info('Chat configs saved successfully');
    } catch (error: any) {
      logger.error(`Error saving chat configs: ${error.message}`);
    }
  }

  public getChatConfig(chatId: string, chatName?: string): ChatConfiguration | undefined {
    return this.chatConfigurations.find(c => c.id === chatId || c.name === chatName);
  }

  public updateChatConfig(chatId: string, chatName: string, isGroup: boolean, options: {
    promptInfo?: string;
    botName?: string;
  }): ChatConfiguration {
    const existingConfig = this.getChatConfig(chatId);

    const updatedConfig: ChatConfiguration = {
      id: chatId,
      name: chatName,
      isGroup: isGroup,
      promptInfo: options.promptInfo !== undefined ? options.promptInfo :
        (existingConfig?.promptInfo || CONFIG.botConfig.promptInfo!),
      ...(existingConfig?.botName && !options.botName && { botName: existingConfig.botName }),
      ...(options.botName && { botName: options.botName })
    };

    const existingIndex = this.chatConfigurations.findIndex(c => c.id === chatId);

    if (existingIndex !== -1) {
      this.chatConfigurations[existingIndex] = updatedConfig;
    } else {
      this.chatConfigurations.push(updatedConfig);
    }

    this.saveChatConfig();
    logger.info(`Updated configuration for ${isGroup ? 'group' : 'chat'} ${chatName} (${chatId})`);

    return updatedConfig;
  }

  public getBotName(chatId: string): string | undefined {
    const configuration = this.getChatConfig(chatId);
    return configuration?.botName;
  }

  public removeChatConfig(chatId: string, chatName?: string): boolean {
    const initialLength = this.chatConfigurations.length;
    this.chatConfigurations = this.chatConfigurations.filter(c => c.id !== chatId && c.name !== chatName);
    const removed = initialLength > this.chatConfigurations.length;

    if (removed) {
      this.saveChatConfig();
      logger.info(`Removed configuration for chat ${chatId}`);
    }

    return removed;
  }

  public listChatConfigurations(): ChatConfiguration[] {
    return this.chatConfigurations;
  }
}

export const chatConfigurationManager = new ChatConfig();
