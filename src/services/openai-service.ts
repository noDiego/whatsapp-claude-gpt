import logger from '../logger';
import { OpenAI, toFile } from 'openai';
import { AIConfig } from '../config';
import { ResponseInput, Tool } from "openai/resources/responses/responses";
import { Message } from "whatsapp-web.js";
import Roboto from "../index";
import { ChatConfiguration } from "../interfaces/chat-configuration";

export class OpenaiService {

  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: AIConfig.OpenAIApiKey,
    });
  }

  /**
   * Sends a list of chat messages to the OpenAI API, including support for tool (function) calls.
   * Processes any returned function_call events by invoking the corresponding local tools,
   * appending their outputs to the conversation, and re-invoking the API until no more calls remain.
   *
   * @param messageList   Array of messages (ResponseInput[]) representing the conversation so far.
   * @param responseType  Format of the response text (e.g. "text", "html").
   * @param tools         Array of Tool definitions that the model may invoke.
   * @param message       The original incoming Message (for context or routing).
   * @param chatCfg
   * @returns             A Promise resolving to the final assistant reply, or null if no tool produced output.
   */
  async sendChatWithTools(
      messageList: ResponseInput,
      responseType: any = 'json_object',
      tools: Array<Tool>,
      message: Message,
      chatCfg: ChatConfiguration,
  ): Promise<string> {
    logger.info(`[OpenAI] Sending ${messageList.length} messages`);
    logger.debug(`[OpenAI] Sending Msg: ${JSON.stringify(messageList[messageList.length - 1])}`);

    const responseResult = await this.client.responses.create({
      model: AIConfig.chatModel,
      input: messageList,
      text: { format: { type: responseType } },
      reasoning: {},
      tools: tools,
      temperature: 0.8,
      top_p: 0.9,
      store: true
    });

    logger.debug('[OpenAI] Completion Response:' + JSON.stringify(responseResult.output_text));

    const functionCalls = responseResult.output.filter(toolCall => toolCall.type === "function_call");
    if (functionCalls.length === 0) return responseResult.output_text;

    const updatedMessages: ResponseInput = [...messageList as any];
    let gotAnyResult = false;

    for (const toolCall of functionCalls) {
      const name = toolCall.name;
      const args = JSON.parse(toolCall.arguments);

      logger.debug(`[OpenAI] Called function "${name}".`);

      try {
        const result = await Roboto.executeFunctions(name, args, message, chatCfg);
        if(!result) continue;
        gotAnyResult = true;

        updatedMessages.push(toolCall);
        updatedMessages.push({
          type: "function_call_output",
          call_id: toolCall.call_id,
          output: result.toString()
        });
      } catch (error) {
        logger.error(`[OpenAI] Error executing function ${name}:`, error);
        updatedMessages.push({
          type: "function_call_output",
          call_id: toolCall.call_id,
          output: `Error executing function ${name}.`
        });
      }

    }
    if (!gotAnyResult) return null;
    return this.sendChatWithTools(updatedMessages, responseType, tools, message, chatCfg);
  }

  /**
   * Generates one or more images from a text prompt using the configured image model.
   *
   * @param prompt    The textual description to guide image generation.
   * @param options   Optional parameters:
   *                   - n: number of images to generate (default 1)
   *                   - size: dimensions, e.g. "1024x1024" (default)
   *                   - quality: "low"|"medium"|"high"|"auto"
   *                   - background: "opaque"|"transparent"|"auto"
   * @returns         A Promise resolving to an array of generated image objects (URLs or base64 data).
   */
  async createImage(
      prompt: string,
      options?: {
        n?: number;
        size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
        quality?: "low" | "medium" | "high" | "auto";
        background?: "opaque" | "transparent" | "auto";
      }
  ) {
    logger.debug(`[OpenAI->createImage] Prompt: "${prompt}"`);

    const params: any = {
      model: AIConfig.imageModel,
      prompt,
      n: options?.n ?? 1,
      size: options?.size ?? "1024x1024",
      quality: options?.quality ?? "auto",
      background: options?.background ?? "auto",
    };

    const response = await this.client.images.generate(params);
    logger.debug(`[OpenAI->createImage] Image generated`);

    return response.data;
  }


  /**
   * Edits or composes one or more existing images using a text prompt and optional mask.
   *
   * @param imageStreams  Array of image streams or blobs to be edited.
   * @param prompt        Text description of desired edits or composition.
   * @param maskStream    Optional stream or blob containing an alpha-mask to apply to the first image.
   * @param options       Optional parameters:
   *                       - n: number of output images (default 1)
   *                       - size: output dimensions (default "1024x1024")
   *                       - quality: "low"|"medium"|"high"|"auto"
   *                       - background: "opaque"|"transparent"|"auto"
   * @returns             A Promise resolving to an array of edited image objects.
   */
  async editImage(
      imageStreams: Array<NodeJS.ReadableStream | Blob>,
      prompt: string,
      maskStream?: NodeJS.ReadableStream | Blob,
      options?: {
        n?: number;
        size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
        quality?: "low" | "medium" | "high" | "auto";
        background?: "opaque" | "transparent" | "auto";
      }
  ) {
    logger.debug(`[OpenAI->editImage] Prompt: "${prompt}"`);

    // Convert each input stream/blob into File objects
    const imageFiles = await Promise.all(
        imageStreams.map((stream, idx) =>
            toFile(stream, `image_${idx}.png`, { type: "image/png" })
        )
    );

    // Si nos pasan máscara, la convertimos (se aplicará a imageFiles[0])
    let maskFile;
    if (maskStream) {
      maskFile = await toFile(maskStream, "mask.png", { type: "image/png" });
    }

    // Armamos los parámetros para la llamada
    const params: any = {
      model: "gpt-image-1",
      image: imageFiles,
      prompt,
      n: options?.n ?? 1,
      size: options?.size ?? "1024x1024",
      quality: options?.quality ?? "auto",
      background: options?.background ?? "auto",
    };

    if (maskFile) {
      params.mask = maskFile;
    }

    // Llamada a la API
    const response = await this.client.images.edit(params);
    logger.debug(`[OpenAI->editImage] Image(s) edited`);

    return response.data;
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
  async speech(message, responseFormat?, voice?: any, instructions?:string) {

    logger.debug(`[OpenAI->speech] Creating speech audio for: "${message}". Voice:${voice}. Instructions:${instructions}`);

    const response: any = await this.client.audio.speech.create({
      model: AIConfig.ttsModel,
      voice: voice?.toLowerCase()  || AIConfig.ttsVoice,
      instructions: instructions,
      input: message,
      response_format: responseFormat || 'mp3'
    });

    logger.debug(`[OpenAI->speech] Audio Creation OK`);

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Transcribes audio content into text using the configured speech-to-text model.
   *
   * @param stream   A ReadableStream or Blob of the audio file to transcribe.
   * @returns        A Promise resolving to the transcribed text string.
   * @throws         Propagates any errors encountered during file conversion or API call.
   */
  async transcription(stream: any) {
    logger.debug(`[OpenAI->transcription] Creating transcription text for audio"`);

    try {
      const file = await toFile(stream, 'audio.ogg', {type: 'audio/ogg'});
      const response = await this.client.audio.transcriptions.create({
        file: file,
        model: AIConfig.sttModel,
        language: AIConfig.sttLanguage
      });
      return response.text;
    } catch (e: any) {
      logger.error(e.message);
      throw e;
    }
  }

}
