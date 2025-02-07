import axios, { AxiosResponse } from 'axios';
import logger from '../logger';
import { CONFIG } from '../config';

export enum CVoices { //TEST VOICES
  JIRO = 'MtkHkdD3cw8GUlrgMMuM',
  DARKAYSER = 'kSv7ExgVZm6PJMseGkKu',
  CHAINER = '170l9BgOYvdt9LkK6Bkg',
  CAIN = 'zq4MUhutQpQKs3OA6fgF',
  AKARA = 'teMPK4uoK2JqyNAxMUnI',
  PINERA = 'nppBs8tfCJ2smgETSuOb',
  PINOCHO = 'qcv1vSIo5ukABa4OPPm2',
  WENCHO = 'cNX4JVnC2gBtWgNynNSt',
  NOXFER = 'jlV396zr6NdomGXoB5aK',
  VALERIA = '9oPKasc15pfAbMr7N6Gs', //Argentina
  SARAH = 'gD1IexrzCvsXPHUuT0s3', //Española
  DANDAN = '9F4C8ztpNUmXkdDDbz3J', //Española
  CAMILA = 'k8fyM7r8e13c8YeLhcrC'
}

export async function elevenTTS(voice: CVoices, msg: string, model?: string): Promise<any> {

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;
  const body = {
    text: msg,
    model_id: model || CONFIG.ElevenSpeech.model,
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.35,
      use_speaker_boost: true
    },
  };
  const headers = {
    accept: 'audio/mpeg',
    'xi-api-key': CONFIG.ElevenSpeech.apiKey,
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
    const response: AxiosResponse = await axios(options);
    return response.data;
  } catch (error) {
    logger.error(error);
  }
}
