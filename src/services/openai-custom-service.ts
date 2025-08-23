import logger from '../logger';
import { OpenAI, toFile } from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { AIConfig, CONFIG } from '../config';
import { ChatCompletion } from 'openai/src/resources/chat/completions';
import { Tool } from "openai/resources/responses/responses";
import NodeCache from "node-cache";
import { AIRole } from "../interfaces/ai-interfaces";
import { sanitizeLogImages } from "../utils";
import Roboto from "../bot/roboto";

class CustomOpenAIService {

  private messagesCache = new NodeCache();

  constructor() {
  }

  public deleteChatCache(chatId: string){
    this.messagesCache.del(chatId);
  }

  public addMessageToCache(item: ChatCompletionMessageParam, chatId: string){
    const aiMessages: ChatCompletionMessageParam[] = this.messagesCache.get(chatId) || [];
    aiMessages.push(item);
    this.messagesCache.set(chatId, aiMessages, CONFIG.BotConfig.nodeCacheTime);
  }

  public async sendMessage(aiMessagesInputList: ChatCompletionMessageParam[], systemPrompt: string, chatId: string, tools: any): Promise<string> {
    let cycleCount = 0;
    const maxCycles = 5;

    const aiMessages: any[]  = this.messagesCache.get(chatId) || [];
    aiMessages.push(...aiMessagesInputList)

    while (cycleCount < maxCycles) {
      const aiResponse: OpenAI.ChatCompletionMessage = await this.sendCompletion(aiMessages, 'text', tools, systemPrompt);

      const tool_calls = aiResponse.tool_calls || [];
      let hasFunctionCall = tool_calls.length > 0;
      const functionOutputs = [];

      for (const output of tool_calls) {

        if (output.type == 'function') {
          aiMessages.push(aiResponse);

          hasFunctionCall = true;
          const functionResult = await Roboto.handleFunction(output.function.name, output.function.arguments);

          functionOutputs.push({role: "tool", tool_call_id: output.id, content: JSON.stringify(functionResult)})

        } else {
          logger.error(`[CustomOpenAIService] Unknown output type received : "${output.type}". Please report this issue.`);
        }
      }

      aiMessages.push(...functionOutputs);

      cycleCount += 1;

      if (!hasFunctionCall) {
        aiMessages.push(aiResponse);
        this.messagesCache.set(chatId, aiMessages, CONFIG.BotConfig.nodeCacheTime);
        return aiResponse.content;
      }
    }

    throw new Error(`Reached the limit of ${maxCycles} communication cycles with OpenAI.`);
  }

  /**
   * Sends a series of messages to the OpenAI Chat Completion API and retrieves a generated completion.
   * This function is designed to interact with the OpenAI API, sending it a context composed of several messages.
   * It then receives a response that is generated based on this context, aiming to provide a coherent and contextually appropriate continuation or reply.
   *
   * Parameters:
   * - messageList: An array of ChatCompletionMessageParam objects, which include the messages that form the context for the API request.
   *
   * Returns:
   * - A promise that resolves to the generated completion string, which is the API's response based on the provided context.
   */
  async sendCompletion(
      messageList: ChatCompletionMessageParam[],
      responseType: 'json_object'|'text' = 'text',
      tools: Array<Tool>,
      systemPrompt?: string
  ): Promise<OpenAI.ChatCompletionMessage> {

    const client = new OpenAI({
      baseURL: AIConfig.ChatConfig.baseURL,
      apiKey: AIConfig.ChatConfig.apiKey,
    });

    const hasSystemMsg = (messageList[0] as any).role == AIRole.SYSTEM;
    if(systemPrompt) {
      if(hasSystemMsg) messageList.shift();
      messageList.unshift({role: AIRole.SYSTEM, content: systemPrompt});
    }

    logger.info(`[${AIConfig.ChatConfig.provider}] Sending ${messageList.length} messages`);
    logger.debug(`[${AIConfig.ChatConfig.provider}] Sending Msg: ${sanitizeLogImages(JSON.stringify(messageList[messageList.length - 1]))}`);

    const params: any = {
      model: AIConfig.ChatConfig.model,
      messages: messageList,
      reasoning_effort: AIConfig.ChatConfig.reasoningEffort as any,
      response_format: {
        type: responseType
      },
      tools: tools,
      store: true
    }
    const response: ChatCompletion = await client.chat.completions.create(params);

    logger.debug(`[${AIConfig.ChatConfig.provider}] ResponsesAPI Usage: Input=${response.usage?.prompt_tokens}` + ` Cached=${response.usage?.prompt_tokens_details?.cached_tokens}` + ` Output=${response.usage?.completion_tokens}`);
    logger.debug(`[${AIConfig.ChatConfig.provider}] ResponsesAPI Response:` + sanitizeLogImages(JSON.stringify(response.choices[0].message)));

    return response.choices[0].message;
  }

  async generateImage(prompt) {

    const client = new OpenAI({
      baseURL: AIConfig.ImageConfig.baseURL,
      apiKey: AIConfig.ImageConfig.apiKey,
    });

    logger.debug(`[${AIConfig.ImageConfig.provider}->generateImage] Creating image with prompt: ${prompt}`);

    const response = await client.images.generate({
      prompt: prompt,
      model: AIConfig.ImageConfig.model,
      n: 1,
      size: "1024x1024"
    });

    return response.data;
  }


}

const CustomOpenAISvc = new CustomOpenAIService();

export default CustomOpenAISvc;