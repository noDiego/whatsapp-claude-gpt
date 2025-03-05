import { config } from 'dotenv';
import { CVoices } from '../services/elevenlabs-service';

config();

const Providers = {
  OPENAI: {
    baseURL: undefined,
    apiKey: process.env.OPENAI_API_KEY
  },
  CLAUDE: {
    baseURL: undefined,
    apiKey: process.env.CLAUDE_API_KEY
  },
  QWEN: {
    baseURL: process.env.QWEN_BASEURL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKey:  process.env.QWEN_API_KEY
  },
  DEEPSEEK: {
    baseURL: process.env.DEEPSEEK_BASEURL ?? 'https://api.deepseek.com',
    apiKey:  process.env.DEEPSEEK_API_KEY,
    analyzeImageDisabled: true
  },
  ELEVENLABS: {
    apiKey: process.env.ELEVENLABS_API_KEY,
  },
  DEEPINFRA: {
    apiKey: process.env.DEEPINFRA_API_KEY,
    baseURL: process.env.DEEPINFRA_BASEURL ?? 'https://api.deepinfra.com/v1/openai'
  },
  CUSTOM: {
    baseURL: process.env.CUSTOM_BASEURL,
    apiKey:  process.env.CUSTOM_API_KEY,
    analyzeImageDisabled: true
  }
}

const ChatConfig = {
  provider: process.env.CHAT_PROVIDER?.toUpperCase() || process.env.AI_LANGUAGE?.toUpperCase() || "OPENAI",
  models: {
    OPENAI: process.env.CHAT_COMPLETION_MODEL ?? process.env.OPENAI_COMPLETION_MODEL ?? 'gpt-4o-mini',
    CLAUDE: process.env.CLAUDE_CHAT_MODEL ?? 'claude-3-sonnet-20240229',
    QWEN: process.env.QWEN_COMPLETION_MODEL ?? 'qwen2.5-vl-72b-instruct',
    DEEPSEEK: process.env.DEEPSEEK_COMPLETION_MODEL ?? 'deepseek-chat',
    DEEPINFRA: process.env.DEEPINFRA_COMPLETION_MODEL ?? 'meta-llama/Llama-3.3-70B-Instruct',
    CUSTOM: process.env.CUSTOM_COMPLETION_MODEL,
  }
};

const ImageConfig = {
  provider: process.env.IMAGE_PROVIDER?.toUpperCase() || "OPENAI",
  models: {
    OPENAI: process.env.IMAGE_CREATION_MODEL?? process.env.OPENAI_IMAGE_MODEL ?? 'dall-e-3',
    DEEPINFRA: process.env.DEEPINFRA_IMAGE_MODEL ?? 'stabilityai/sd3.5',
  },
  enabled: process.env.IMAGE_CREATION_ENABLED?.toLocaleLowerCase() === 'true' ,
};

const TranscriptionConfig = {
  provider: process.env.TRANSCRIPTION_PROVIDER?.toUpperCase() || "OPENAI",
  models: {
    OPENAI: process.env.TRANSCRIPTION_MODEL ?? process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'whisper-1',
    DEEPINFRA: process.env.DEEPINFRA_TRANSCRIPTION_MODEL ?? 'openai/whisper-large-v3-turbo',
  },
  language: process.env.TRANSCRIPTION_LANGUAGE ?? "en",
  enabled: process.env.VOICE_MESSAGES_ENABLED?.toLocaleLowerCase() === 'true',
};

const SpeechConfig = {
  provider: process.env.SPEECH_PROVIDER?.toUpperCase() || "OPENAI",
  models: {
    OPENAI: process.env.SPEECH_MODEL ?? process.env.OPENAI_SPEECH_MODEL ?? 'tts-1',
    ELEVENLABS: process.env.ELEVENLABS_SPEECH_MODEL ?? 'eleven_multilingual_v2'
  },
  voice: {
    OPENAI:process.env.OPENAI_SPEECH_VOICE ?? process.env.SPEECH_VOICE ?? "nova",
    ELEVENLABS: process.env.ELEVENLABS_VOICEID || CVoices.SARAH,
  },
  enabled: process.env.VOICE_MESSAGES_ENABLED?.toLocaleLowerCase() === 'true',
};

export const AIConfig = {
  ChatConfig:{
    provider: ChatConfig.provider,
    model: ChatConfig.models[ChatConfig.provider],
    baseURL: Providers[ChatConfig.provider].baseURL,
    apiKey: Providers[ChatConfig.provider].apiKey,
    analyzeImageDisabled: Providers[ChatConfig.provider].analyzeImageDisabled,
  },
  ImageConfig:{
    provider: ImageConfig.provider,
    model: ImageConfig.models[ImageConfig.provider],
    baseURL: Providers[ImageConfig.provider].baseURL,
    apiKey: Providers[ImageConfig.provider].apiKey,
    enabled: ImageConfig.enabled
  },
  TranscriptionConfig: {
    provider: TranscriptionConfig.provider,
    model: TranscriptionConfig.models[TranscriptionConfig.provider],
    baseURL: Providers[TranscriptionConfig.provider].baseURL,
    apiKey: Providers[TranscriptionConfig.provider].apiKey,
    language: TranscriptionConfig.language[TranscriptionConfig.provider],
    enabled: TranscriptionConfig.enabled
  },
  SpeechConfig: {
    provider: SpeechConfig.provider,
    model: SpeechConfig.models[SpeechConfig.provider],
    baseURL: Providers[SpeechConfig.provider].baseURL,
    apiKey: Providers[SpeechConfig.provider].apiKey,
    voice: SpeechConfig.voice[SpeechConfig.provider],
    enabled: SpeechConfig.enabled
  }

}

// General bot configuration parameters
const botConfig = {
  preferredLanguage: process.env.PREFERRED_LANGUAGE ?? '', // The default language for the bot. If not specified, the bot will use the language of the chat it is responding to
  botName: process.env.BOT_NAME ?? 'Roboto', // The name of the bot, used to identify when the bot is being addressed in group chats
  maxCharacters: parseInt(process.env.MAX_CHARACTERS ?? '2000'), //The maximum number of characters the chat model will output in a single completion
  maxImages: parseInt(process.env.MAX_IMAGES ?? '5'), // The maximum number of images the bot will process from the last received messages
  maxMsgsLimit: parseInt(process.env.MAX_MSGS_LIMIT ?? '30'), // The maximum number of recent messages the bot will consider for generating a coherent response
  maxHoursLimit: parseInt(process.env.MAX_HOURS_LIMIT ?? '24'), // The maximum hours a message's age can be for the bot to consider it in generating responses
  transcriptionLanguage: process.env.TRANSCRIPTION_LANGUAGE ?? "en", //The language of the input audio for transcriptions. Supplying the input language in [ISO-639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) format will improve accuracy and latency.
  nodeCacheTime: parseInt(process.env.NODE_CACHE_TIME ?? '259200'), // The cache duration for stored data, specified in seconds.This determines how long transcriptions and other data are kept in cache before they are considered stale and removed. Example value is 259200, which translates to 3 days.
  promptInfo: process.env.PROMPT_INFO // You can use this to customize the bot's personality and provide context about the group or individuals for tailored interactions.
};

// Dynamically generate the bot's initial prompt based on configuration parameters
function getSystemPrompt(customInfo?: string, customBotName?: string){
  return `You are an assistant operating on WhatsApp. Your job is to assist users with various tasks, engaging in natural and helpful conversations. Here’s what you need to remember:
- You go by the name ${customBotName? customBotName : botConfig.botName}. Always introduce yourself in the first interaction with any user.
- The current date is ${new Date().toLocaleDateString()}. 
${AIConfig.ChatConfig.analyzeImageDisabled?'- You can\'t analyze images.':'You can analyze images'}
- Keep your responses concise and informative; you should not exceed the ${botConfig.maxCharacters} character limit.
- You have a short-term memory able to recall only the last ${botConfig.maxMsgsLimit} messages and forget anything older than ${botConfig.maxHoursLimit} hours.
- When images are sent to you, remember that you can only consider the latest ${botConfig.maxImages} images for your tasks.
- If users need to reset any ongoing task or context, they should use the "-reset" command. This will cause you to not remember anything that was said previously to the command.
${botConfig.preferredLanguage ? `- Preferably you will try to speak in ${botConfig.preferredLanguage}.` : ``}

- **Response Format**: All your responses must be in JSON format with the following structure:
  {
    "message": "<your response>",
    "author": "BotName",
    "type": "<TEXT or AUDIO>"
  }

${AIConfig.SpeechConfig.enabled ? `
- **Audio Messages**: 
  - You can send responses in audio format. Use "type": "AUDIO" when responding with audio messages. Respond in the "message" field with what you are responding to, this will later be converted into audio for the user.
  - **Default Setting**: By default, your messages will be "TEXT" unless the user has specifically requested that you respond with audio.
  - **Summarize Audios**: All audio messages should be as brief and concise as possible.
` : `
- **Audio Messages Disabled**: 
  - All your responses must have "type": "TEXT" as audio messages are disabled.
`}

${AIConfig.ImageConfig.enabled ? `
- **Image Creation**: 
  - You can create images. If a user requests an image, guide them to use the command “-image <description>”. For example, respond with, “To create an image, please use the command '-image a dancing dog'.”
- **Command Accuracy**: 
  - Accuracy is key. If a command is misspelled, kindly notify the user of the mistake and suggest the correct command format. For instance, “It seems like there might be a typo in your command. Did you mean '-image' for generating images?”` : ``}

${botConfig.promptInfo || customInfo ? ` 
- **Additional Instructions for Specific Context**: 
  - Important: The following is specific information for the group or individuals you are interacting with: "${customInfo ?? botConfig.promptInfo}"` : ''}.
`;
}

export const CONFIG = {
  appName: 'Whatsapp-Claude-GPT',
  botConfig,
  ImageConfig,
  ChatConfig,
  SpeechConfig,
  TranscriptionConfig,
  getSystemPrompt
};
