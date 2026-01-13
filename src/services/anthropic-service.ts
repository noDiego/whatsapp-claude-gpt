import logger from '../logger';
import Anthropic from '@anthropic-ai/sdk';
import { AIConfig, CONFIG } from '../config';
import { MessageParam, TextBlock } from '@anthropic-ai/sdk/resources';
import Roboto from "../bot/roboto";
import NodeCache from "node-cache";
import { AIRole } from "../interfaces/ai-interfaces";
import { countMessages, trimCachePreserveMessageStart } from "../utils";
import { ChatConfiguration } from "../config/chat-configurations";
import LLMMessages from "./llm-cache";

class AnthropicService {

  private anthropic : Anthropic;
  private messagesCache = new NodeCache();

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: AIConfig.ChatConfig.apiKey,
    });
  }

  public deleteChatCache(chatId: string){
    this.messagesCache.del(chatId);
  }

  public addMessageToCache(item: MessageParam, chatId: string){
    const aiMessages: any[] = this.messagesCache.get(chatId) || [];
    aiMessages.push(item);
    this.messagesCache.set(chatId, aiMessages, CONFIG.BotConfig.nodeCacheTime);
  }
  public hasChatCache(chatId: string): boolean {
    return this.messagesCache.has(chatId);
  }

  public async sendMessage(
      aiMessagesInputList: MessageParam[],
      systemPrompt: string,
      chatConfig: ChatConfiguration,
      tools: any
  ): Promise<string> {
    let cycleCount = 0;
    const maxCycles = 5;
    const chatId = chatConfig.chatId;
    const maxMessages = chatConfig.maxMsgsLimit ?? 30;

    LLMMessages.lock(chatId);

    try {
      const aiMessages: any[] = LLMMessages.getMessages(chatId);
      aiMessages.push(...aiMessagesInputList);

      if (aiMessages.length > maxMessages + 5) {
        LLMMessages.trimMessages(chatId, maxMessages);
      }

      while (cycleCount < maxCycles) {
        const aiResponse = await this.sendToApi(aiMessages, systemPrompt, tools);
        let hasFunctionCall = false;

        aiMessages.push({
          role: AIRole.ASSISTANT,
          content: aiResponse.content
        });

        const resultContent = [];

        for (const c of aiResponse.content) {
          if (c.type == 'tool_use') {
            hasFunctionCall = true;
            const functionResult = await Roboto.handleFunction(c.name, c.input);

            resultContent.push({
              type: "tool_result",
              tool_use_id: c.id,
              content: JSON.stringify(functionResult)
            });
          }
        }

        if (resultContent.length > 0) {
          aiMessages.push({
            role: AIRole.USER,
            content: resultContent
          });
        }

        cycleCount += 1;

        if (!hasFunctionCall) {
          if (aiMessages.length > maxMessages) {
            LLMMessages.trimMessages(chatId, maxMessages);
          }

          LLMMessages.saveMessages(chatId);
          const content = aiResponse.content[0];
          return (content as TextBlock)?.text || "";
        }

        if (aiMessages.length > maxMessages + 10) {
          logger.warn(`[Claude] Trimming during function cycles`);
          LLMMessages.trimMessages(chatId, maxMessages);
        }
      }

      throw new Error(`Reached the limit of ${maxCycles} cycles.`);

    } finally {
      LLMMessages.unlock(chatId);
    }
  }

  async sendToApi(
      messageList: MessageParam[],
      systemPrompt: string,
      tools: any
  ) {

    logger.debug(`[Claude->sendCompletion] Sending ${countMessages(messageList)} messages.`);

    const response = await this.anthropic.messages.create({
      system: systemPrompt,
      model: AIConfig.ChatConfig.model,
      messages: messageList,
      max_tokens: 2048,
      top_p: 1,
      tools
    });

    logger.debug('[Claude->sendCompletion] Completion Response:');
    logger.debug(response.content[0]);

    return response;

    // const responseContent = response.content[0] as TextBlock;
    //
    // return responseContent;
  }

}



const AnthropicSvc = new AnthropicService();
export default AnthropicSvc
