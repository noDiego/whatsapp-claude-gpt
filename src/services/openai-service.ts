import logger from '../logger';
import OpenAI, { toFile } from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { CONFIG } from '../config';
import { AiAnswer, AiLanguage } from '../interfaces/ai-message';
import { OpenaiAiconfig } from '../interfaces/openai-aiconfig';
import { logGPTMessages } from '../utils';
import { ResponseInput } from "openai/resources/responses/responses";
import { Tool } from "openai/src/resources/responses/responses";

export class OpenaiService {

  private openai: OpenAI;
  private openaiCustom: OpenAI;
  private readonly AIConfig: OpenaiAiconfig;

  constructor() {
    const openAIConfig: OpenaiAiconfig = CONFIG.AIConfigs[AiLanguage.OPENAI];
    const customConfig: OpenaiAiconfig = CONFIG.AIConfigs[CONFIG.botConfig.aiLanguage];
    this.AIConfig = openAIConfig;

    if(CONFIG.botConfig.aiLanguage != AiLanguage.OPENAI) {
      this.openaiCustom = new OpenAI({
        baseURL: customConfig.baseURL,
        apiKey: customConfig.apiKey,
      });
      this.AIConfig.chatModel = customConfig.chatModel;
    }

    this.openai = new OpenAI({
      apiKey: openAIConfig.apiKey,
    });
  }

  async sendChatWithTools(
      messageList: ResponseInput,
      model: string,
      tools?: Array<Tool>
  ): Promise<string> {

    logger.info(`[OpenAI] Sending ${messageList.length} messages`);
    logger.debug(`[OpenAI] Sending Msg: ${JSON.stringify(messageList[messageList.length - 1])}`);

    const responseResult = await this.openai.responses.create({
      model: model || this.AIConfig.chatModel,
      input: messageList,
      text: {
        format: {
          type: 'text'
        }
      },
      reasoning: {},
      tools: tools,
      temperature: 1,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    logger.debug('[OpenAI] Completion Response:' + JSON.stringify(responseResult.output_text));

    const messageResult = responseResult.output_text;

    const functionCalls = responseResult.output.filter(toolCall => toolCall.type === "function_call");
    if (functionCalls.length === 0)
      return messageResult;

    let updatedMessages: ResponseInput = [...messageList as any];

    for (const toolCall of responseResult.output) {
      if (toolCall.type !== "function_call") {
        continue;
      }

      updatedMessages.push(toolCall);

      // TODO: I have not implemented functions yet, so they will not be processed.
      //const name = toolCall.name;
      //const args = JSON.parse(toolCall.arguments);
      //
      // try {
      //
      //   // const result = await executeFunctions(name, args, inputData);
      //   updatedMessages.push({
      //     type: "function_call_output",
      //     call_id: toolCall.call_id,
      //     output: result.toString()
      //   });
      // }catch (error) {
      //   logger.error(`Error executing function ${name}:`, error);
      //   updatedMessages.push({
      //     type: "function_call_output",
      //     call_id: toolCall.call_id,
      //     output: `Error executing function ${name}.`
      //   });
      // }
    }

    // Recursive call with updated messages
    return this.sendChatWithTools(updatedMessages, model, tools);
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
  async sendCompletion(messageList: ChatCompletionMessageParam[], systemPrompt: string, model: string): Promise<AiAnswer> {
    const MAX_RETRIES = 1;
    model = model || this.AIConfig.chatModel;
    let currentTry = 0;
    let lastError: any;


    const isO1 = model.startsWith('o1');

    messageList.unshift({role: isO1 ? 'user' : 'system', content: [{type: 'text', text: systemPrompt}]});

    logger.info(`[${CONFIG.botConfig.aiLanguage}->sendCompletion] Sending ${messageList.length} messages (Model:${model})`);

    logger.debug(`[${CONFIG.botConfig.aiLanguage}->sendCompletion] Message List (Last 4 Elements):`);
    logGPTMessages(messageList, 4);

    const params: any = isO1 ? {
      model: model,
      messages: messageList,
      store: true,
      stream: true,
      reasoning_effort: "medium"
    } : {
      model: model,
      messages: messageList,
      response_format: {
        type: "json_object"
      },
      max_tokens: 2048,
      top_p: 1,
      frequency_penalty: 0.5,
      presence_penalty: 0,
      store: true,
      stream: true,
    }

    while (currentTry <= MAX_RETRIES) {
      try {
        logger.debug(`[${CONFIG.botConfig.aiLanguage}->sendCompletion] Attempt ${currentTry + 1}/${MAX_RETRIES + 1}: Sending ${messageList.length} messages.`);

        const stream: any = this.openaiCustom ?
          await this.openaiCustom.chat.completions.create(params) :
          await this.openai.chat.completions.create(params);

        let fullResponse = '';
        let usage;

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          usage = chunk.usage || '';
          fullResponse += content;
        }

        if (fullResponse == '') throw new Error(`An error occurred while communicating with ${CONFIG.botConfig.aiLanguage}. It returned an empty response.`);

        logger.debug(`[${CONFIG.botConfig.aiLanguage}->sendCompletion] Completion Response:`);
        logger.debug(fullResponse);

        this.logTokens(usage);

        return JSON.parse(fullResponse) as AiAnswer;

      } catch (e: any) {
        lastError = e;
        currentTry++;

        if (currentTry <= MAX_RETRIES) {
          logger.warn(`[${CONFIG.botConfig.aiLanguage}->sendCompletion] Attempt ${currentTry}/${MAX_RETRIES + 1} failed: ${e.message ?? e}`);
          await new Promise(resolve => setTimeout(resolve, 500 * currentTry));
        } else {
          logger.error(`[${CONFIG.botConfig.aiLanguage}->sendCompletion] All ${MAX_RETRIES + 1} attempts failed. Last error: ${e.message ?? e}`);
          throw new Error(`Failed after ${MAX_RETRIES + 1} attempts. Last error: ${e.message ?? e}. Please try again later or consider using an alternative AI. If the issue persists, contact support for further assistance.`);
        }
      }
    }
    throw lastError;
  }

  /**
   * Requests the generation of an image based on a textual description, by interacting with OpenAI's image generation API.
   * This function takes a prompt in the form of text and sends a request to generate an image that corresponds with the text description provided.
   * It aims to utilize OpenAI's capabilities to create visually representative images based on textual inputs.
   *
   * Parameters:
   * - message: A string containing the text description that serves as the prompt for image generation.
   *
   * Returns:
   * - A promise that resolves to the URL of the generated image. This URL points to the image created by OpenAI's API based on the input prompt.
   */
  async createImage(message){

    logger.debug(`[OpenAI->createImage] Creating message for: "${message}"`);

    const response = await this.openai.images.generate({
      model: this.AIConfig.imageModel,
      prompt: message,
      quality: 'standard',
      n: 1,
      size: "1024x1024",
    });
    return response.data[0].url;
  }

  /**
   * Edits an existing image based on a text prompt and a mask image (optional).
   * This function takes an original image, an optional mask image, and a prompt to generate
   * an edited version of the image according to the text description.
   *
   * @param originalImage - A buffer containing the original image data
   * @param maskImage - Optional buffer containing the mask image data, indicating areas to edit
   * @param prompt - A string describing the edits to make to the image
   * @returns A promise that resolves to the URL of the edited image
   */
  async editImage(originalImage: Buffer, maskImage: Buffer | null, prompt: string) {
    logger.debug(`[OpenAI->editImage] Editing image with prompt: "${prompt}"`);

    try {
      // Instalar sharp si no lo has hecho: npm install sharp
      const sharp = require('sharp');

      // Procesar la imagen: redimensionar, añadir canal alfa y convertir a PNG
      const processedImage = await sharp(originalImage)
          .resize({
            width: 1024,
            height: 1024,
            fit: 'inside',
            withoutEnlargement: true
          })
          .ensureAlpha() // Agregar canal alfa (transparencia)
          .png({ compressionLevel: 9 }) // Alta compresión
          .toBuffer();

      // Verificar el tamaño
      if (processedImage.length > 4 * 1024 * 1024) {
        throw new Error('Image is too large even after processing. Must be less than 4 MB.');
      }

      // Log para verificar el tamaño de la imagen procesada
      logger.debug(`[OpenAI->editImage] Processed image size: ${(processedImage.length / 1024 / 1024).toFixed(2)} MB`);

      // Convert buffer to File required by OpenAI API
      const imageFile = await toFile(processedImage, 'image.png', { type: 'image/png' });

      const requestParams: any = {
        model: 'dall-e-2',
        image: imageFile,
        prompt: prompt,
        n: 1,
        size: "1024x1024",
      };

      // Add mask if provided
      if (maskImage) {
        // Procesar también la máscara si existe
        const processedMask = await sharp(maskImage)
            .resize({
              width: 1024,
              height: 1024,
              fit: 'inside',
              withoutEnlargement: true
            })
            .ensureAlpha() // Asegurar que la máscara también tenga canal alfa
            .png({ compressionLevel: 9 })
            .toBuffer();

        const maskFile = await toFile(processedMask, 'mask.png', { type: 'image/png' });
        requestParams.mask = maskFile;
      }

      const response = await this.openai.images.edit(requestParams);

      logger.debug(`[OpenAI->editImage] Image editing completed successfully`);
      return response.data[0].url;
    } catch (e: any) {
      logger.error(`[OpenAI->editImage] Error editing image: ${e.message}`);
      throw new Error(`Failed to edit image: ${e.message}`);
    }
  }

  /**
   * Generates speech audio from provided text by utilizing OpenAI's Text-to-Speech (TTS) API.
   * This function translates text into spoken words in an audio format. It offers a way to convert written messages into audio, providing an audible version of the text content.
   * If a specific voice model is specified in the configuration, the generated speech will use that voice.
   *
   * Parameters:
   * - message: A string containing the text to be converted into speech. This text serves as the input for the TTS engine.
   *
   * Returns:
   * - A promise that resolves to a buffer containing the audio data in MP3 format. This buffer can be played back or sent as an audio message.
   */
  async speech(message, responseFormat?, instructions?: string){

    logger.debug(`[OpenAI->speech] Creating speech audio for: "${message}"`);

    const requestParams = {
      model: this.AIConfig.speechModel,
      voice: this.AIConfig.speechVoice,
      instructions: instructions,
      input: message,
      response_format: responseFormat || 'mp3'
    };

    const response: any = await this.openai.audio.speech.create(requestParams);

    logger.debug(`[OpenAI->speech] Audio Creation OK`);

    return Buffer.from(await response.arrayBuffer());
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
    logger.debug(`[OpenAI->transcription] Creating transcription text for audio"`);
    try {
      // Convertir ReadStream a File o Blob
      const file = await toFile(stream, 'audio.ogg', { type: 'audio/ogg' });
      // Enviar el archivo convertido a la API de transcripción
      const response = await this.openai.audio.transcriptions.create({
        file: file,
        model: this.AIConfig.transcriptionModel,
        language: CONFIG.botConfig.transcriptionLanguage
      });
      return response.text;
    } catch (e: any) {
      logger.error(e.message);
      throw e;
    }
  }

  private logTokens(usage: any){
    if(!usage) return;
      const promptTokens = usage.prompt_tokens;
      const cachedTokens = usage.prompt_tokens_details.cached_tokens;
      const completionTokens = usage.completion_tokens;
      logger.info(`PromptTokens: ${promptTokens}. CachedTokens: ${cachedTokens}. CompletionTokens: ${completionTokens}. Totaltokens: ${usage.total_tokens}`)
  }

}
