import logger from '../logger';
import { OpenAI, toFile } from 'openai';
import { AIConfig, CONFIG } from '../config';
import { ResponseInput, ResponseInputItem, Tool } from "openai/resources/responses/responses";

import { countMessages, sanitizeForLog, trimCachePreserveMessageStart } from "../utils";
import { AIRole, AIService, ToolExecutionContext } from "../interfaces/ai-interfaces";
import NodeCache from "node-cache";
import Roboto from "../bot/roboto";
import { ChatConfiguration } from "../config/chat-configurations";

class OpenaiService implements AIService<ResponseInputItem, Tool[]> {

  private messagesCache = new NodeCache({
    stdTTL: CONFIG.BotConfig.messageCacheTtl || CONFIG.BotConfig.nodeCacheTime,
    checkperiod: 600, // Cleanup expired keys every 10 minutes
  });
  private static clientCache = new Map<string, OpenAI>();

  constructor() {
  }

  /**
   * Returns a cached OpenAI client keyed by baseURL+apiKey.
   * Avoids creating a new HTTP agent per call on the hot path.
   */
  private getClient(baseURL?: string, apiKey?: string): OpenAI {
    const key = `${baseURL ?? ''}::${apiKey ?? ''}`;
    let client = OpenaiService.clientCache.get(key);
    if (!client) {
      client = new OpenAI({ baseURL, apiKey });
      OpenaiService.clientCache.set(key, client);
    }
    return client;
  }

  public deleteChatCache(chatId: string){
    this.messagesCache.del(chatId);
  }

  public addMessageToCache(item: ResponseInputItem, chatId: string){
    const openAiMessages: ResponseInput = this.messagesCache.get(chatId) || [];
    openAiMessages.push(item);
    this.messagesCache.set(chatId, openAiMessages, CONFIG.BotConfig.nodeCacheTime);
  }

  public hasChatCache(chatId: string): boolean {
      return this.messagesCache.has(chatId);
  }

  public async sendMessage(aiMessageInputList: ResponseInputItem[], systemPrompt: string, chatConfig: ChatConfiguration, tools: Tool[], toolContext?: ToolExecutionContext): Promise<string> {
    let cycleCount = 0;
    const maxCycles = 6;
    const chatId = chatConfig.chatId;

    const aiMessages: ResponseInput = this.messagesCache.get(chatId) || [];
    aiMessages.push(...aiMessageInputList)

    while (cycleCount < maxCycles) {
      const aiResponse = await this.sendToResponsesAPI(aiMessages, 'text', tools, systemPrompt);

      let hasFunctionCall = false;
      const functionOutputs= [];

      for (const output of aiResponse.output) {
        aiMessages.push(output as unknown as ResponseInputItem);
        if (output.type === 'function_call') {
          hasFunctionCall = true;
          const functionResult = await Roboto.handleFunction(output.name, output.arguments, toolContext);
          functionOutputs.push({
            type: "function_call_output",
            call_id: output.call_id,
            output: JSON.stringify(functionResult)
          });
        } else if(output.type !== 'message' && output.type !== 'reasoning' && output.type !== 'web_search_call'){
          logger.error(`Unknown output type received from OpenAI: "${output.type}". Please report this issue.`);
        }
      }

      aiMessages.push(...functionOutputs);

      cycleCount += 1;

      if (!hasFunctionCall) {
        const finalMsgList = trimCachePreserveMessageStart(aiMessages, chatConfig.maxMsgsLimit ?? 30);
        this.messagesCache.set(chatId, finalMsgList, CONFIG.BotConfig.nodeCacheTime);
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
    logger.info(`[OpenAI] Sending ${countMessages(messageList)} messages`);
    logger.debug(`[OpenAI] Sending Msg: ${JSON.stringify(sanitizeForLog(messageList[messageList.length - 1]))}`);

    const reasoningProfile = getReasoningProfile(AIConfig.ChatConfig.model);

    const client = this.getClient(AIConfig.ChatConfig.baseURL, AIConfig.ChatConfig.apiKey);

    const hasSystemMsg = (messageList[0] as any).role == AIRole.SYSTEM;
    if(systemPrompt) {
      if(hasSystemMsg) messageList.shift();
      messageList.unshift({role: AIRole.SYSTEM, content: systemPrompt});
    }

    const responseResult = await client.responses.create({
      model: AIConfig.ChatConfig.model,
      input: messageList,
      text: {
        format: { type: responseType },
        verbosity: reasoningProfile.enabled ? "low" : undefined
      },
      reasoning: reasoningProfile.enabled
          ? { summary: reasoningProfile.summary, effort: reasoningProfile.effort }
          : undefined,
      tools,
      store: true
    } as any);

    logger.debug(`[OpenAI] ResponsesAPI Usage: Input=${responseResult.usage.input_tokens}` + ` Cached=${responseResult.usage.input_tokens_details?.cached_tokens}` + ` Output=${responseResult.usage.output_tokens}`);
    logger.debug('[OpenAI] ResponsesAPI Response:' + JSON.stringify(sanitizeForLog(responseResult.output_text)));

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

    const client = this.getClient(AIConfig.TranscriptionConfig.baseURL, AIConfig.TranscriptionConfig.apiKey);

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


    const client = this.getClient(AIConfig.SpeechConfig.baseURL, AIConfig.SpeechConfig.apiKey);

    const params = {
      model: AIConfig.SpeechConfig.model,
      voice: voice?.toLowerCase() ?? AIConfig.SpeechConfig.voice,
      instructions: instructions,
      input: message,
      response_format: responseFormat || 'mp3'
    }

    logger.debug(`[${AIConfig.SpeechConfig.provider}->speech] Creating speech audio (${params.input?.length ?? 0} chars, voice:${params.voice})`);


    const response: any = await client.audio.speech.create(params);

    logger.debug(`[${AIConfig.SpeechConfig.provider}->speech] Audio Creation OK`);

    return Buffer.from(await response.arrayBuffer());
  }

  async generateImage(params: {
    prompt: string;
    imageStreams?: Array<NodeJS.ReadableStream | Blob>;
    maskStream?: NodeJS.ReadableStream | Blob;
    n?: number;
    output_format?: "png" | "jpg" | "webp";
    size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
    quality?: "low" | "medium" | "high" | "auto";
    background?: "opaque" | "transparent" | "auto";
  }) {
    const client = this.getClient(AIConfig.ImageConfig.baseURL, AIConfig.ImageConfig.apiKey);

    logger.debug(`[${AIConfig.ImageConfig.provider}->generateImage] Creating image (prompt: ${sanitizeForLog(params.prompt)?.substring(0, 100) ?? 'N/A'}, quality: ${params.quality ?? AIConfig.ImageConfig.quality})`);

    const isEdit = params.imageStreams && params.imageStreams.length > 0;
    const quality = params.quality ?? AIConfig.ImageConfig.quality;
    const isMini = AIConfig.ImageConfig.model.includes("mini");

    const baseParams: any = {
      input_fidelity: isEdit && !isMini? 'high': undefined,
      model: AIConfig.ImageConfig.model,
      prompt: params.prompt,
      n: params.n ?? 1,
      size: params.size ?? "auto",
      quality: quality == 'high' && isMini? 'auto': quality,
      background: params.background ?? "auto",
      output_format: params.output_format ?? "jpeg",
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

type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

type ReasoningProfile =
    | { enabled: false }
    | { enabled: true; effort: ReasoningEffort; summary: null };

const MODEL_REASONING: Record<string, ReasoningProfile> = {
  // GPT-5.x
  "gpt-5.4":      { enabled: true, effort: "low",    summary: null },
  "gpt-5.4-mini": { enabled: true, effort: "low",    summary: null },
  "gpt-5.4-nano": { enabled: true, effort: "low",    summary: null },
  "gpt-5.4-pro":  { enabled: true, effort: "medium", summary: null },

  "gpt-5.2":      { enabled: true, effort: "low",    summary: null },
  "gpt-5.2-pro":  { enabled: true, effort: "medium", summary: null },

  "gpt-5.1":      { enabled: true, effort: "low",    summary: null },

  "gpt-5":        { enabled: true, effort: "low",    summary: null },
  "gpt-5-mini":   { enabled: true, effort: "low",    summary: null },
  "gpt-5-nano":   { enabled: true, effort: "low",    summary: null },
  "gpt-5-pro":    { enabled: true, effort: "high",   summary: null },

  // Si usas modelos codex:
  "gpt-5.3-codex": { enabled: true, effort: "low", summary: null },
  "gpt-5.2-codex": { enabled: true, effort: "low", summary: null },

  // No reasoning
  "gpt-5.3-chat-latest":  { enabled: false },
  "gpt-4.1":              { enabled: false },
  "gpt-4.1-mini":         { enabled: false },
  "gpt-4.1-nano":         { enabled: false },
  "gpt-4o":               { enabled: false },
  "gpt-4o-mini":          { enabled: false },
};

function normalizeModel(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function getReasoningProfile(model: string): ReasoningProfile {
  const normalized = normalizeModel(model);
  return MODEL_REASONING[normalized] ?? { enabled: false };
}

const OpenAISvc = new OpenaiService();

export default OpenAISvc;
