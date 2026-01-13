import logger from '../logger';
import { OpenAI } from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { AIConfig, CONFIG } from '../config';
import { ChatCompletion } from 'openai/src/resources/chat/completions';
import { Tool } from "openai/resources/responses/responses";
import { AIRole } from "../interfaces/ai-interfaces";
import { cleanChatCompletionMessage, countMessages, sanitizeLogImages, trimCachePreserveMessageStart } from "../utils";
import Roboto from "../bot/roboto";
import { ChatConfiguration } from "../config/chat-configurations";
import LLMMessages from "./llm-cache";

class CustomOpenAIService {

  constructor() {
  }

  public async sendMessage(aiMessagesInputList: ChatCompletionMessageParam[], systemPrompt: string, chatConfig: ChatConfiguration, tools: any): Promise<string> {
    let cycleCount = 0;
    const maxCycles = 5;
    const chatId = chatConfig.chatId;
    const maxMessages = chatConfig.maxMsgsLimit ?? 30;

    LLMMessages.lock(chatId);

    try {
      const aiMessages: any[] = LLMMessages.getMessages(chatId);
      aiMessages.push(...aiMessagesInputList)

      if (aiMessages.length > maxMessages + 5) {
        LLMMessages.trimMessages(chatId, maxMessages);
      }

      while (cycleCount < maxCycles) {
        const aiResponse: OpenAI.ChatCompletionMessage = await this.sendCompletion(aiMessages, 'text', tools, systemPrompt);

        const tool_calls = aiResponse.tool_calls || [];
        let hasFunctionCall = tool_calls.length > 0;
        const functionOutputs = [];

        for (const output of tool_calls) {

          if (output.type == 'function') {
            aiMessages.push(cleanChatCompletionMessage(aiResponse));

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
          aiMessages.push(cleanChatCompletionMessage(aiResponse));
          if (aiMessages.length > maxMessages) {
            LLMMessages.trimMessages(chatId, maxMessages);
          }
          LLMMessages.saveMessages(chatId);
          return aiResponse.content;
        }

        if (aiMessages.length > maxMessages + 10) {
          logger.warn(`[OpenAI] Message count (${aiMessages.length}) exceeded limit during function calls. Trimming...`);
          LLMMessages.trimMessages(chatId, maxMessages);
        }

      }

      throw new Error(`Reached the limit of ${maxCycles} communication cycles with OpenAI.`);
    } finally {
      LLMMessages.unlock(chatId);
    }
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

    logger.info(`[${AIConfig.ChatConfig.provider}] Sending ${countMessages(messageList)} messages`);
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