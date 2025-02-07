import { PostgresClient } from '../database/postgresql';
import { ChatCfg } from '../interfaces/chatconfig';
import { Chat, Message } from 'whatsapp-web.js';
import { includePrefix } from '../utils';

export class ChatConfigService {

  private db: PostgresClient;
  private chatConfigs: ChatCfg[];

  constructor() {
    this.db = PostgresClient.getInstance();
    this.loadChatConfigs();
  }

  public async loadChatConfigs(){
    const chatConfigs = await this.db.getChatConfigs();
    this.chatConfigs = chatConfigs.sort((a, b) => (a.groups === '*' ? 1 : b.groups === '*' ? -1 : 0));
  }

  public async getChatConfig(message: Message, chatData: Chat): Promise<ChatCfg | null>{
    /** Iterate through saved configurations */
    for (const chatCfg of this.chatConfigs) {
      /** Check if the message comes from the config's group */
      const groupMatch = chatData.isGroup && chatCfg.groups.split('|').includes(chatData.name);
      /** Check if the message includes the config's prefix */
      const prefixMatch = includePrefix(message.body, chatCfg.prefix);
      /** Check if someone is replying to the bot */
      const isReplyToMe = message.hasQuotedMsg ? (await message.getQuotedMessage()).fromMe : false;

      /** Return config if it belongs to the group and either prefix matches or if someone is replying */
      if(groupMatch && (prefixMatch || isReplyToMe)) return chatCfg;
      /** Case for bots that can be invoked at any time through their name */
      if(prefixMatch && chatCfg.groups == '-') return chatCfg;
      /** If no other matches, return the config that matches with group "*" and is using the corresponding prefix */
      if(chatCfg.groups == '*' && (prefixMatch || isReplyToMe || !chatData.isGroup)) return chatCfg;
    }
    return null;
  }

}
