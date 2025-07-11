// src/config/chat-configurations.ts
import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';
import { CONFIG } from './index';
import { ChatConfiguration } from "../interfaces/chat-configuration";
import { PostgresClient } from "../db/postgresql";
import mergeWith from 'lodash.mergewith';

const CHATCONFIG_FILE = path.join(process.cwd(), 'chat-configurations.json');

interface ChatConfigStorage {
  loadConfigurations(): Promise<ChatConfiguration[]>;
  saveConfigurations(configs: ChatConfiguration[]): Promise<void>;
}

class JsonChatConfigStorage implements ChatConfigStorage {
  async loadConfigurations(): Promise<ChatConfiguration[]> {
    try {
      if (fs.existsSync(CHATCONFIG_FILE)) {
        const data = fs.readFileSync(CHATCONFIG_FILE, 'utf8');
        const configs = JSON.parse(data);
        logger.info(`Loaded ${configs.length} chat configurations from JSON file`);
        return configs;
      } else {
        logger.info('No chat config file found, creating a new one');
        fs.writeFileSync(CHATCONFIG_FILE, JSON.stringify([]), 'utf8');
        return [];
      }
    } catch (error: any) {
      logger.error(`Error loading chat configuration from file: ${error.message}`);
      return [];
    }
  }

  async saveConfigurations(configs: ChatConfiguration[]): Promise<void> {
    try {
      const data = JSON.stringify(configs, null, 2);
      fs.writeFileSync(CHATCONFIG_FILE, data, 'utf8');
      logger.info('Chat configs saved successfully to JSON file');
    } catch (error: any) {
      logger.error(`Error saving chat configs to file: ${error.message}`);
    }
  }
}

class PostgresChatConfigStorage implements ChatConfigStorage {
  private db: PostgresClient;

  constructor() {
    this.db = PostgresClient.getInstance();
  }

  async loadConfigurations(): Promise<ChatConfiguration[]> {
    try {
      const configs = await this.db.getChatConfigs();
      logger.info(`Loaded ${configs.length} chat configurations from database`);
      return configs;
    } catch (error: any) {
      logger.error(`Error loading chat configurations from database: ${error.message}`);
      return [];
    }
  }

  async saveConfigurations(configs: ChatConfiguration[]): Promise<void> {
    try {
      for (const config of configs) {
        const existingConfig = await this.db.getChatConfigById(config.id);
        if (existingConfig) {
          await this.db.updateChatConfig(config.id, config);
        } else {
          await this.db.createChatConfig(config);
        }
      }
      logger.info('Chat configs saved successfully to database');
    } catch (error: any) {
      logger.error(`Error saving chat configs to database: ${error.message}`);
    }
  }
}

export class ChatConfig {
  private chatConfigurations: ChatConfiguration[];
  private storage: ChatConfigStorage;
  private useDatabase: boolean;
  private static instance: ChatConfig;

  public static getInstance(): ChatConfig {
    if (!ChatConfig.instance) ChatConfig.instance = new ChatConfig();
    return ChatConfig.instance;
  }

  private constructor() {
      this.chatConfigurations = [];
      this.useDatabase = process.env.CHAT_CONFIG_STORAGE?.toLowerCase() === 'database';
      this.storage = this.useDatabase
          ? new PostgresChatConfigStorage()
          : new JsonChatConfigStorage();
      this.initializeConfigs();
  }

  private async initializeConfigs() {
    try {
      this.chatConfigurations = await this.storage.loadConfigurations();
    } catch (error: any) {
      logger.error(`Error initializing chat configurations: ${error.message}`);
      this.chatConfigurations = [];
      await this.saveChatConfig();
    }
  }

  public async reloadConfigurations(): Promise<boolean> {
    try {
      logger.info(`Reloading chat configurations from ${this.useDatabase ? 'database' : 'file'}...`);
      this.chatConfigurations = await this.storage.loadConfigurations();
      logger.info(`Successfully reloaded ${this.chatConfigurations.length} chat configurations`);
      return true;
    } catch (error: any) {
      logger.error(`Failed to reload chat configurations: ${error.message}`);
      return false;
    }
  }

  private async saveChatConfig() {
    await this.storage.saveConfigurations(this.chatConfigurations);
  }

  private readConfig(chatId: string, chatName?: string): ChatConfiguration | undefined {
    const customConfig = this.chatConfigurations.find(c => c.id === chatId) ||
        this.chatConfigurations.find(c => c.name === chatName)
    return customConfig || this.chatConfigurations.find(c => c.id === '*');
  }

  public getChatConfig(chatId: string, chatName?: string): ChatConfiguration {
    const defaults: ChatConfiguration = {
      id: chatId,
      name: chatName ?? chatId,
      botName:     CONFIG.botConfig.botName,
      promptInfo: CONFIG.botConfig.promptInfo,
      maxImages:     CONFIG.botConfig.maxImages,
      maxMsgsLimit:  CONFIG.botConfig.maxMsgsLimit,
      maxHoursLimit: CONFIG.botConfig.maxHoursLimit,
      chatModel: CONFIG.AIConfig.chatModel,
      imageModel: CONFIG.AIConfig.imageModel,
      ttsProvider: CONFIG.AIConfig.ttsProvider,
      ttsModel: CONFIG.AIConfig.ttsModel,
      ttsVoice: CONFIG.AIConfig.ttsVoice,
      sttModel: CONFIG.AIConfig.sttModel,
      sttLanguage: CONFIG.AIConfig.sttLanguage,
      imageCreationEnabled: CONFIG.AIConfig.imageCreationEnabled,
      voiceCreationEnabled: CONFIG.AIConfig.voiceCreationEnabled
    }

    const override = this.readConfig(chatId, chatName) || {};

    const customizer = (objVal: any, srcVal: any) => {
      if (srcVal === undefined || srcVal === null ||
          (typeof srcVal === 'string' && srcVal.trim() === '')) {
        return objVal;
      }
      return undefined;
    };

    return mergeWith({...defaults}, override, customizer);
  }

  public async updateChatConfig(chatId: string, chatName: string, isGroup: boolean, options: {
    promptInfo?: string;
    botName?: string;
  }): Promise<ChatConfiguration> {
    const existingConfig = this.readConfig(chatId);

    const updatedConfig: ChatConfiguration = {
      id: chatId,
      name: chatName,
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

    await this.saveChatConfig();
    logger.info(`Updated configuration for ${isGroup ? 'group' : 'chat'} ${chatName} (${chatId})`);

    return updatedConfig;
  }

  public getBotName(chatId: string): string | undefined {
    const configuration = this.readConfig(chatId);
    return configuration?.botName;
  }

  public async removeChatConfig(chatId: string, chatName?: string): Promise<boolean> {
    const initialLength = this.chatConfigurations.length;
    this.chatConfigurations = this.chatConfigurations.filter(c => c.id !== chatId && c.name !== chatName);
    const removed = initialLength > this.chatConfigurations.length;

    if (removed) {
      await this.saveChatConfig();
      logger.info(`Removed configuration for chat ${chatId}`);
    }

    return removed;
  }
}