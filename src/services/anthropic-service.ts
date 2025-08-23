import logger from '../logger';
import Anthropic from '@anthropic-ai/sdk';
import { AIConfig, CONFIG } from '../config';
import { MessageParam, TextBlock } from '@anthropic-ai/sdk/resources';
import { ChatCompletionMessageParam } from "openai/resources";
import { OpenAI } from "openai";
import Roboto from "../bot/roboto";
import NodeCache from "node-cache";
import { AIRole } from "../interfaces/ai-interfaces";

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

  public async sendMessage(aiMessagesInputList: MessageParam[], systemPrompt: string, chatId: string, tools: any): Promise<string> {
    let cycleCount = 0;
    const maxCycles = 5;

    const aiMessages: any[]  = this.messagesCache.get(chatId) || [];
    aiMessages.push(...aiMessagesInputList)

    while (cycleCount < maxCycles) {
      const aiResponse: Anthropic.Messages.Message = await this.sendToApi(aiMessages, systemPrompt, tools);

      let hasFunctionCall = false;

      aiMessages.push({
        role: AIRole.ASSISTANT,
        content: aiResponse.content
      })

      const resultContent = [];

      for (const c of aiResponse.content) {

        if (c.type == 'tool_use') {
          hasFunctionCall = true;
          const functionResult = await Roboto.handleFunction(c.name, c.input);

          resultContent.push({
              type: "tool_result",
              tool_use_id: c.id,
              content: JSON.stringify(functionResult)
          })
        }
      }

      if(resultContent.length>0)
        aiMessages.push({
          role: AIRole.USER,
          content: resultContent
        });

      cycleCount += 1;

      if (!hasFunctionCall) {
        this.messagesCache.set(chatId, aiMessages, CONFIG.BotConfig.nodeCacheTime);
        const content = aiResponse.content[0];
        return (content as TextBlock)?.text || "";
      }
    }

    throw new Error(`Reached the limit of ${maxCycles} communication cycles with OpenAI.`);
  }

  async sendToApi(
      messageList: MessageParam[],
      systemPrompt: string,
      tools: any
  ) {

    logger.debug(`[Claude->sendCompletion] Sending ${messageList.length} messages.`);

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
