import logger from '../logger';
import Anthropic from '@anthropic-ai/sdk';
import { AIConfig } from '../config';
import { TextBlock } from '@anthropic-ai/sdk/resources';
import MessageParam = Anthropic.MessageParam;

export class AnthropicService {

  private anthropic : Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: AIConfig.ChatConfig.apiKey,
    });
  }

  async sendChat(messageList: MessageParam[], systemPrompt: string) {

    logger.debug(`[Claude->sendCompletion] Sending ${messageList.length} messages.`);

    const response = await this.anthropic.messages.create({
      system: systemPrompt,
      model: AIConfig.ChatConfig.model,
      messages: messageList,
      max_tokens: 1024,
      top_p: 1
    });

    logger.debug('[Claude->sendCompletion] Completion Response:');
    logger.debug(response.content[0]);

    const responseContent = response.content[0] as TextBlock;

    return JSON.parse(responseContent.text);
  }

}
