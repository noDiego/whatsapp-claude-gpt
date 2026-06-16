import axios, { AxiosResponse } from 'axios';
import logger from '../logger';
import { AIConfig } from '../config';
import { sanitizeForLog } from '../utils';

export enum CVoices {
  GEORGE = 'JBFqnCBsd6RMkjVDRZzb',
  SARAH = 'EXAVITQu4vr4xnSDxMaL',
  LILY = 'pFZP5JQG7iQjIQuC4Bku',
  ALICE = 'Xb7hH8MSUJpSbSDYk0k2',
  ARIA = '9BWtsMINqrJLrRacOk9x'
}

export async function elevenTTS(msg: string, voice: CVoices = CVoices.LILY): Promise<string> {

  logger.debug(`[${AIConfig.SpeechConfig.provider}->speech] Creating speech audio (${msg?.length ?? 0} chars)`);

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice ?? AIConfig.SpeechConfig.voice}?output_format=mp3_44100_128`;
  const body = {
    text: msg,
    model_id: AIConfig.SpeechConfig.model,
    voice_settings: {
      stability: 0.7,
      similarity_boost: 0.7,
      style: 0.25,
      use_speaker_boost: true
    },
  };

  const headers = {
    'xi-api-key': AIConfig.SpeechConfig.apiKey,
    'Content-Type': 'application/json',
  };

  const options: any = {
    responseType: 'arraybuffer',
    method: 'POST',
    headers: headers,
    data: body,
    url,
  };

  try {
    const response: AxiosResponse<any> = await axios(options);
    if (!response.data || response.data.length === 0) {
      throw new Error('ElevenLabs returned empty audio data.');
    }
    const audioBuffer = Buffer.from(response.data);
    return audioBuffer.toString('base64');
  } catch (error: any) {
    logger.error(`[ElevenLabs->TTS] Error: ${JSON.stringify(sanitizeForLog(error))}`);
    throw new Error(`ElevenLabs TTS failed: ${error.message}`);
  }
}
