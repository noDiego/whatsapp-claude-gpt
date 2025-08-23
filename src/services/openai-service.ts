import logger from '../logger';
import { OpenAI, toFile } from 'openai';
import { AIConfig, CONFIG } from '../config';
import { ResponseInput, ResponseInputItem, Tool } from "openai/resources/responses/responses";

import { sanitizeLogImages } from "../utils";
import { AIRole } from "../interfaces/ai-interfaces";
import NodeCache from "node-cache";
import Roboto from "../bot/roboto";
import { ChatConfiguration } from "../config/chat-configurations";

class OpenaiService {

  private messagesCache = new NodeCache();

  constructor() {
  }

  public deleteChatCache(chatId: string){
    this.messagesCache.del(chatId);
  }

  public addMessageToCache(item: ResponseInputItem, chatId: string){
    const openAiMessages: ResponseInput = this.messagesCache.get(chatId) || [];
    openAiMessages.push(item);
    this.messagesCache.set(chatId, openAiMessages, CONFIG.BotConfig.nodeCacheTime);
  }

  public async sendMessage(openAiMessageInputList: ResponseInputItem[], systemPrompt: string, chatId: string, tools: Tool[]): Promise<string> {
    let cycleCount = 0;
    const maxCycles = 6;

    const openAiMessages: ResponseInput = this.messagesCache.get(chatId) || [];
    openAiMessages.push(...openAiMessageInputList)

    while (cycleCount < maxCycles) {
      const aiResponse = await this.sendToResponsesAPI(openAiMessages, 'text', tools, systemPrompt);

      let hasFunctionCall = false;
      const functionOutputs= [];

      for (const output of aiResponse.output) {
        openAiMessages.push(output);
        if (output.type === 'function_call') {
          hasFunctionCall = true;
          const functionResult = await Roboto.handleFunction(output.name, output.arguments);
          functionOutputs.push({
            type: "function_call_output",
            call_id: output.call_id,
            output: JSON.stringify(functionResult)
          });
        } else if(output.type !== 'message' && output.type !== 'reasoning' && output.type !== 'web_search_call'){
          logger.error(`Unknown output type received from OpenAI: "${output.type}". Please report this issue.`);
        }
      }

      openAiMessages.push(...functionOutputs);

      cycleCount += 1;

      if (!hasFunctionCall) {
        this.messagesCache.set(chatId, openAiMessages, CONFIG.BotConfig.nodeCacheTime);
        return aiResponse.output_text;
      }
    }

    throw new Error(`Reached the limit of ${maxCycles} communication cycles with OpenAI.`);
  }

  private async sendToResponsesAPI(
      messageList: ResponseInput,
      responseType: 'json_object'|'text' = 'json_object',
      tools: Array<Tool>,
      systemPrompt?: string
  ): Promise<OpenAI.Responses.Response> {
    logger.info(`[OpenAI] Sending ${messageList.length} messages`);
    logger.debug(`[OpenAI] Sending Msg: ${sanitizeLogImages(JSON.stringify(messageList[messageList.length - 1]))}`);

    const client = new OpenAI({
      baseURL: AIConfig.ChatConfig.baseURL,
      apiKey: AIConfig.ChatConfig.apiKey,
    });

    const hasSystemMsg = (messageList[0] as any).role == AIRole.SYSTEM;
    if(systemPrompt) {
      if(hasSystemMsg) messageList.shift();
      messageList.unshift({role: AIRole.SYSTEM, content: systemPrompt});
    }

    const responseResult = await client.responses.create({
      model: AIConfig.ChatConfig.model,
      input: messageList,
      text: { format: { type: responseType } },
      reasoning: { summary: null },
      tools: tools,
      // max_output_tokens: 4096,
      store: true
    });

    logger.debug(`[OpenAI] ResponsesAPI Usage: Input=${responseResult.usage.input_tokens}` + ` Cached=${responseResult.usage.input_tokens_details?.cached_tokens}` + ` Output=${responseResult.usage.output_tokens}`);
    logger.debug('[OpenAI] ResponsesAPI Response:' + sanitizeLogImages(JSON.stringify(responseResult.output_text)));

    return responseResult;
  }

  /**
   * Transcribes audio content into text using OpenAI's transcription capabilities.
   * This function takes an audio file and sends a request to OpenAI's API to generate a textual representation of the spoken words.
   * It leverages the Whisper model for high-quality transcription, converting audio inputs into readable text output.
   *
   * Parameters:
   * - message: A string indicating the audio file path or description for logging purposes. Currently, it is not used in the function's implementation but can be helpful for future extensions or logging clarity.
   *
   * Returns:
   * - A promise that resolves to a string containing the transcribed text. This string is the result of processing the provided audio through OpenAI's transcription model.
   *
   * Throws:
   * - Any errors encountered during the process of reading the audio file or interacting with OpenAI's API will be thrown and should be handled by the caller function.
   */
  async transcription(stream: any) {
    logger.debug(`[${AIConfig.TranscriptionConfig.provider}->transcription] Creating transcription text for audio"`);

    const client = new OpenAI({
      baseURL: AIConfig.TranscriptionConfig.baseURL,
      apiKey: AIConfig.TranscriptionConfig.apiKey,
    });

    const file = await toFile(stream, 'audio.ogg', {type: 'audio/ogg'});
    const response = await client.audio.transcriptions.create({
      file: file,
      model: AIConfig.TranscriptionConfig.model,
      language: AIConfig.TranscriptionConfig.language
    });
    return response.text;
  }

  /**
   * Converts input text into spoken audio using the configured TTS model.
   *
   * @param message          The text to be synthesized.
   * @param responseFormat   Audio format to return (e.g. "mp3", "wav"); defaults to "mp3".
   * @param voice            Optional voice identifier (overrides default).
   * @param instructions     Optional pronunciation or style instructions for the TTS engine.
   * @returns                A Promise resolving to a Buffer containing the binary audio data.
   */
  async speech(message, responseFormat?, voice = 'nova', instructions?:string) {


    const client = new OpenAI({
      baseURL: AIConfig.SpeechConfig.baseURL,
      apiKey: AIConfig.SpeechConfig.apiKey,
    });

    const params = {
      model: AIConfig.SpeechConfig.model,
      voice: voice?.toLowerCase() ?? AIConfig.SpeechConfig.voice,
      instructions: instructions,
      input: message,
      response_format: responseFormat || 'mp3'
    }

    logger.debug(`[${AIConfig.SpeechConfig.provider}->speech] Creating speech audio for: "${params.input}". Voice:${params.voice}. Instructions:${params.instructions}`);


    const response: any = await client.audio.speech.create(params);

    logger.debug(`[${AIConfig.SpeechConfig.provider}->speech] Audio Creation OK`);

    return Buffer.from(await response.arrayBuffer());
  }

  async generateImage(params: {
    prompt: string;
    imageStreams?: Array<NodeJS.ReadableStream | Blob>;
    maskStream?: NodeJS.ReadableStream | Blob;
    n?: number;
    size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
    quality?: "low" | "medium" | "high" | "auto";
    background?: "opaque" | "transparent" | "auto";
  }) {
    const client = new OpenAI({
      baseURL: AIConfig.ImageConfig.baseURL,
      apiKey: AIConfig.ImageConfig.apiKey,
    });

    logger.debug(`[${AIConfig.ImageConfig.provider}->generateImage] Creating image with params: ${JSON.stringify(params)}`);

    const baseParams: any = {
      model: AIConfig.ImageConfig.model,
      prompt: params.prompt,
      n: params.n ?? 1,
      size: params.size ?? "auto",
      quality: params.quality ?? "medium",
      background: params.background ?? "auto",
      output_format: "jpeg",
      moderation: 'low'
    };

    if (params.imageStreams && params.imageStreams.length > 0) {
      const imageFiles = await Promise.all(
          params.imageStreams.map((stream, idx) => toFile(stream, `image_${idx}.png`, { type: "image/png" }))
      );

      const editParams: any = {
        ...baseParams,
        image: imageFiles,
      };

      if (params.maskStream) {
        editParams.mask = await toFile(params.maskStream, "mask.png", { type: "image/png" });
      }

      return (await client.images.edit(editParams)).data;
    } else {
      return (await client.images.generate(baseParams)).data;
    }
  }

}

const OpenAISvc = new OpenaiService();

export default OpenAISvc;
