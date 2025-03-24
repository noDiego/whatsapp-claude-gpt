import logger from '../logger';
import { OpenAI, toFile } from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { AIConfig } from '../config';
import { AIAnswer } from '../interfaces/ai-interfaces';
import { ChatCompletion } from 'openai/src/resources/chat/completions';
import { cleanAndParseJSON } from '../utils';

export class OpenaiService {

  constructor() {
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
  async sendCompletion(messageList: ChatCompletionMessageParam[]): Promise<AIAnswer> {

    const openAICLient = new OpenAI({
      baseURL: AIConfig.ChatConfig.baseURL,
      apiKey: AIConfig.ChatConfig.apiKey,
    });
    const model = AIConfig.ChatConfig.model;


    const MAX_RETRIES = 1;
    let currentTry = 0;
    let lastError: any;

    const params: any = {
      model: model,
      messages: messageList,
      response_format: {
        type: "json_object"
      },
      store: true
    }

    while (currentTry <= MAX_RETRIES) {
      try {
        logger.debug(`[${AIConfig.ChatConfig.provider}->sendCompletion] Attempt ${currentTry + 1}/${MAX_RETRIES + 1}: Sending ${messageList.length} messages.`);

        const reponse: ChatCompletion = await openAICLient.chat.completions.create(params);

        let fullResponse = reponse.choices[0]?.message?.content;

        if (!fullResponse || fullResponse == '') throw new Error(`An error occurred while communicating with ${AIConfig.ChatConfig.provider}. It returned an empty response.`);

        logger.debug(`[${AIConfig.ChatConfig.provider}->sendCompletion] Completion Response:`);
        logger.debug(fullResponse);

        return cleanAndParseJSON(fullResponse!) as AIAnswer;

      } catch (e: any) {
        lastError = e;
        currentTry++;

        if (currentTry <= MAX_RETRIES) {
          logger.warn(`[${AIConfig.ChatConfig.provider}->sendCompletion] Attempt ${currentTry}/${MAX_RETRIES + 1} failed: ${e.message ?? e}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * currentTry));
        } else {
          logger.error(`[${AIConfig.ChatConfig.provider}->sendCompletion] All ${MAX_RETRIES + 1} attempts failed. Last error: ${e.message ?? e}`);
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
  async createImage(message) {

    logger.debug(`[${AIConfig.ImageConfig.provider}->createImage] Creating message for: "${message}"`);

    const params: any = {
      model: AIConfig.ImageConfig.model,
      prompt: message,
      quality: 'standard',
      n: 1,
      size: "1024x1024",
    }

    const openAICLient = new OpenAI({
      baseURL: AIConfig.ImageConfig.baseURL,
      apiKey: AIConfig.ImageConfig.apiKey,
    });

    const response = await openAICLient.images.generate(params);

    return response.data;
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
  async speech(message, responseFormat?) {

    logger.debug(`[${AIConfig.SpeechConfig.provider}->speech] Creating speech audio for: "${message}"`);

    const openAICLient = new OpenAI({
      baseURL: AIConfig.SpeechConfig.baseURL,
      apiKey: AIConfig.SpeechConfig.apiKey,
    });

    const response: any = await openAICLient.audio.speech.create({
      model: AIConfig.SpeechConfig.model,
      voice: AIConfig.SpeechConfig.voice,
      input: message,
      response_format: responseFormat || 'mp3'
    });

    logger.debug(`[${AIConfig.SpeechConfig.provider}->speech] Audio Creation OK`);

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
    logger.debug(`[${AIConfig.TranscriptionConfig.provider}->transcription] Creating transcription text for audio"`);

    const openAIClient = new OpenAI({
      baseURL: AIConfig.TranscriptionConfig.baseURL,
      apiKey: AIConfig.TranscriptionConfig.apiKey,
    });

    try {
      // Convertir ReadStream a File o Blob
      const file = await toFile(stream, 'audio.ogg', {type: 'audio/ogg'});
      // Enviar el archivo convertido a la API de transcripción
      const response = await openAIClient.audio.transcriptions.create({
        file: file,
        model: AIConfig.TranscriptionConfig.model,
        language: AIConfig.TranscriptionConfig.language
      });
      return response.text;
    } catch (e: any) {
      logger.error(e.message);
      throw e;
    }
  }

}
