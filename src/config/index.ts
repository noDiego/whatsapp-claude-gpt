import { config } from 'dotenv';

config();

const openAI = {
  apiKey: process.env.OPENAI_API_KEY,
  chatCompletionModel: 'gpt-4-vision-preview',
  chatCompletionMaxCharacters: 2000,
  imageCreationModel: 'dall-e-3',
  speechModel: 'tts-1',
  speechVoice: "nova"
};

const botConfig = {
  botName: 'Roboto',
  maxImages: 3,
  maxMsgsLimit: 30,
  maxHoursLimit: 24,
  prompt: '',
  imageCreationEnabled: true,
  audioCreationEnabled: true
};

botConfig.prompt = `You are a helpful assistant in Whatsapp. 
    Your responses should not exceed ${openAI.chatCompletionMaxCharacters} characters. 
    You only remember the last ${botConfig.maxMsgsLimit} messages. 
    You do not remember messages from before ${botConfig.maxHoursLimit} hours. 
    You will only receive the last ${botConfig.maxImages} images sent to you.`;

export const CONFIG = {
  appName: 'Whatsapp-GPT',
  botConfig,
  openAI
};
