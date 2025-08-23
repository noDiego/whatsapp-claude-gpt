import { config } from 'dotenv';
import { CVoices } from '../services/elevenlabs-service';
import { ChatConfiguration } from "./chat-configurations";

config();

const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const Providers = {
  OPENAI: {
    baseURL: undefined,
    apiKey: process.env.OPENAI_API_KEY,
    catEditImages: true
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
    CLAUDE: process.env.CLAUDE_CHAT_MODEL ?? 'claude-sonnet-4-20250514',
    QWEN: process.env.QWEN_COMPLETION_MODEL ?? 'qwen2.5-vl-72b-instruct',
    DEEPSEEK: process.env.DEEPSEEK_COMPLETION_MODEL ?? 'deepseek-chat',
    DEEPINFRA: process.env.DEEPINFRA_COMPLETION_MODEL ?? 'zai-org/GLM-4.5V',
    CUSTOM: process.env.CUSTOM_COMPLETION_MODEL,
  }
};

const ImageConfig = {
  provider: process.env.IMAGE_PROVIDER?.toUpperCase() || "OPENAI",
  models: {
    OPENAI: process.env.IMAGE_CREATION_MODEL?? process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
    DEEPINFRA: process.env.DEEPINFRA_IMAGE_MODEL ?? 'stabilityai/sd3.5',
  },
  enabled: process.env.IMAGE_CREATION_ENABLED?.toLocaleLowerCase() === 'true' ,
};

const TranscriptionConfig = {
  provider: process.env.TRANSCRIPTION_PROVIDER?.toUpperCase() || "OPENAI",
  models: {
    OPENAI: process.env.TRANSCRIPTION_MODEL ?? process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-transcribe',
    DEEPINFRA: process.env.DEEPINFRA_TRANSCRIPTION_MODEL ?? 'openai/whisper-large-v3-turbo',
  },
  language: process.env.TRANSCRIPTION_LANGUAGE ?? "en",
  enabled: process.env.VOICE_MESSAGES_ENABLED?.toLocaleLowerCase() === 'true',
};

const SpeechConfig = {
  provider: process.env.SPEECH_PROVIDER?.toUpperCase() || "OPENAI",
  models: {
    OPENAI: process.env.SPEECH_MODEL ?? process.env.OPENAI_SPEECH_MODEL ?? 'gpt-4o-mini-tts',
    ELEVENLABS: process.env.ELEVENLABS_SPEECH_MODEL ?? 'eleven_multilingual_v2'
  },
  voice: {
    OPENAI:process.env.OPENAI_SPEECH_VOICE ?? process.env.SPEECH_VOICE ?? "nova",
    ELEVENLABS: process.env.ELEVENLABS_VOICEID,
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
    reasoningEffort: process.env.REASONING_EFFORT ?? "low"
  },
  ImageConfig:{
    provider: ImageConfig.provider,
    model: ImageConfig.models[ImageConfig.provider],
    baseURL: Providers[ImageConfig.provider].baseURL,
    apiKey: Providers[ImageConfig.provider].apiKey,
    enabled: ImageConfig.enabled,
    catEditImages: Providers[ChatConfig.provider].catEditImages
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
const BotConfig = {
  preferredLanguage: process.env.PREFERRED_LANGUAGE ?? '', // The default language for the bot. If not specified, the bot will use the language of the chat it is responding to
  botName: process.env.BOT_NAME ?? 'Roboto', // The name of the bot, used to identify when the bot is being addressed in group chats
  maxCharacters: parseInt(process.env.MAX_CHARACTERS ?? '2000'), //The maximum number of characters the chat model will output in a single completion
  maxImages: parseInt(process.env.MAX_IMAGES ?? '5'), // The maximum number of images the bot will process from the last received messages
  maxMsgsLimit: parseInt(process.env.MAX_MSGS_LIMIT ?? '30'), // The maximum number of recent messages the bot will consider for generating a coherent response
  maxHoursLimit: parseInt(process.env.MAX_HOURS_LIMIT ?? '24'), // The maximum hours a message's age can be for the bot to consider it in generating responses
  transcriptionLanguage: process.env.TRANSCRIPTION_LANGUAGE ?? "en", //The language of the input audio for transcriptions. Supplying the input language in [ISO-639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) format will improve accuracy and latency.
  nodeCacheTime: parseInt(process.env.NODE_CACHE_TIME ?? '259200'), // The cache duration for stored data, specified in seconds.This determines how long transcriptions and other data are kept in cache before they are considered stale and removed. Example value is 259200, which translates to 3 days.
  promptInfo: process.env.PROMPT_INFO, // You can use this to customize the bot's personality and provide context about the group or individuals for tailored interactions.
  maxImageSizeMB: Number(process.env.MAX_IMAGE_SIZEMB ?? 10), // The maximum size of images the bot will process
  maxDocumentSizeMB: Number(process.env.MAX_DOCUMENT_SIZEMB ?? 20), // The maximum size of documents the bot will process
  botTimezone: process.env.BOT_TIMEZONE ?? systemTimezone ?? 'UTC',
  memoriesEnabled: process.env.MEMORIES_ENABLED?.toLocaleLowerCase() === 'true', // Whether the bot should remember user data and use it in responses
};

// Dynamically generate the bot's initial prompt based on configuration parameters
function getSystemPrompt(chatConfig: ChatConfiguration, memoriesContext?: string){
  return `You are an assistant operating on WhatsApp. 
- You go by the name ${chatConfig.botName ?? CONFIG.BotConfig.botName}
- Context: This is a ${chatConfig.isGroup ? 'group' : 'one-to-one chat'} (chatId: ${chatConfig.chatId}${chatConfig.name ? `, name: "${chatConfig.name}"` : ''}).
- The current date is ${new Date().toLocaleDateString()}. 
${AIConfig.ChatConfig.analyzeImageDisabled?'- You can\'t analyze images.':''}
- Keep your responses concise and informative; you should not exceed the ${BotConfig.maxCharacters} character limit.
- Adjust the format of your responses for WhatsApp. Avoid Markdown, tables, and long blocks.
- You can only see up to ${BotConfig.maxMsgsLimit} messages from the last ${BotConfig.maxHoursLimit} hours.
${BotConfig.preferredLanguage ? `- Preferably you will try to speak in ${BotConfig.preferredLanguage}.` : ``}

- **Response Format**: All your responses must be in JSON format with the following structure:
  { "message": "<your response>", "emojiReact": "😊" }
  
- **Emoji Reactions**: 
- In the "emojiReact" field, include an emoji that appropriately reacts to the user's last message. If no emoji reaction is appropriate for the context, you can leave this field empty.`+
`${CONFIG.BotConfig.memoriesEnabled?`
- **Memory Management**: Use the user_memory_manager function to remember important personal information about users (age, profession, interests, running jokes, etc.). This helps you have more personalized and contextual conversations. Update user memories naturally during conversations without explicitly announcing when you're storing or updating information, unless the user specifically asks about their stored data
- When a user requests a transcription, do not assume the ASR text is the user's personal information or the user's property, and do not save any of it to memory.`:``}
${memoriesContext ? `${memoriesContext}\n\n` : ''}`+

`${chatConfig.promptInfo ? ` 
- **Important**: The following is information about the chat or group you are interacting with and/or instructions for your personality:\n"${chatConfig.promptInfo}"` : ''}.
`;
}

export const CONFIG = {
  appName: 'Whatsapp-Claude-GPT',
  BotConfig,
  ImageConfig,
  ChatConfig,
  SpeechConfig,
  TranscriptionConfig,
  getSystemPrompt
};
