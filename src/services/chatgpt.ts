import logger from '../logger';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { CONFIG } from '../config';

export class ChatGTP {

  private openai: OpenAI;
  private readonly gptModel: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: CONFIG.openAI.apiKey,
    });
    this.gptModel = <string>process.env.GPT_MODEL;
  }

  async sendCompletion(messageList: ChatCompletionMessageParam[]) {

    logger.debug(`[ChatGTP->sendCompletion] Sending ${messageList.length} messages.`);

    const completion = await this.openai.chat.completions.create({
      model: CONFIG.openAI.chatCompletionModel,
      messages: messageList,
      max_tokens: 512,
      top_p: 1,
      frequency_penalty: 0.5,
      presence_penalty: 0
    });

    logger.debug('[ChatGTP->sendCompletion] Completion Response:');
    logger.debug(completion.choices[0]);

    const messageResult = completion.choices[0].message;

    return messageResult?.content || '';
  }

  async createImage(message){

    logger.debug(`[ChatGTP->createImage] Creating message for: "${message}"`);

    const response = await this.openai.images.generate({
      model: CONFIG.openAI.imageCreationModel,
      prompt: message,
      quality: 'standard',
      n: 1,
      size: "1024x1024",
    });
    return response.data[0].url;
  }

  async speech(message){

    logger.debug(`[ChatGTP->createImage] Creating speech audio for: "${message}"`);

    const response: any = await this.openai.audio.speech.create({
      model: CONFIG.openAI.speechModel,
      voice: <any>CONFIG.openAI.speechVoice,
      input: message,
      response_format: 'mp3'
    });
    return Buffer.from(await response.arrayBuffer());
  }

}
