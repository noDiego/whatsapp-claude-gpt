import { config } from 'dotenv';
import { ChatConfiguration } from "../interfaces/chat-configuration";

config();

const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const DBConfig = {
  user: String(process.env.PSQL_USER),
  password: String(process.env.PSQL_PASS),
  host: process.env.PSQL_HOST!,
  port: process.env.PSQL_PORT!,
  database: process.env.PSQL_DB!,
  schema: process.env.PSQL_SCHEMA!
}

export const AIConfig = {
  OpenAIApiKey: process.env.OPENAI_API_KEY,
  ElevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  chatModel: process.env.CHAT_MODEL ?? 'gpt-4.1',
  imageModel: process.env.IMAGE_MODEL ?? 'gpt-image-1',
  ttsProvider: process.env.TTS_PROVIDER || 'OPENAI',
  ttsModel: process.env.TTS_MODEL ?? 'gpt-4o-mini-tts',
  ttsVoice: process.env.TTS_VOICE ?? "nova",
  sttModel: process.env.TRANSCRIPTION_MODEL ?? 'gpt-4o-transcribe',
  sttLanguage: process.env.TRANSCRIPTION_LANGUAGE ?? 'en', //The language of the input audio for transcriptions. Supplying the input language in [ISO-639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) format will improve accuracy and latency.
  imageCreationEnabled: process.env.IMAGE_CREATION_ENABLED,
  voiceCreationEnabled: process.env.VOICE_MESSAGES_ENABLED
}

// General bot configuration parameters
const botConfig = {
  chatconfigStorage: process.env.CHAT_CONFIG_STORAGE ?? 'file', // If set to 'database', a connection to a configured database in "DBConfig" will be used for custom chat configurations
  preferredLanguage: process.env.PREFERRED_LANGUAGE ?? '', // The default language for the bot. If not specified, the bot will use the language of the chat it is responding to
  botTimezone: process.env.BOT_TIMEZONE ?? systemTimezone ?? 'UTC',
  botName: process.env.BOT_NAME ?? 'Roboto', // The name of the bot, used to identify when the bot is being addressed in group chats
  maxImages: parseInt(process.env.MAX_IMAGES ?? '7'), // The maximum number of images the bot will process from the last received messages
  maxMsgsLimit: parseInt(process.env.MAX_MSGS_LIMIT ?? '30'), // The maximum number of recent messages the bot will consider for generating a coherent response
  maxHoursLimit: parseInt(process.env.MAX_HOURS_LIMIT ?? '24'), // The maximum hours a message's age can be for the bot to consider it in generating responses
  nodeCacheTime: parseInt(process.env.NODE_CACHE_TIME ?? '259200'), // The cache duration for stored data, specified in seconds.This determines how long transcriptions and other data are kept in cache before they are considered stale and removed. Example value is 259200, which translates to 3 days.
  promptInfo: process.env.PROMPT_INFO, // You can use this to customize the bot's personality and provide context about the group or individuals for tailored interactions.
  superUserNumbers: process.env.SUPERUSER_NUMBERS?.split('|') || [],
  maxImageCreationRetry: 2,
  restrictedNumbers: (<string>process.env.RESTRICTED_NUMBERS).split(','),
};

// Dynamically generate the bot's initial prompt based on configuration parameters
function getSystemPrompt(chatCfg: ChatConfiguration){

  return `You are an assistant operating on WhatsApp. Here’s what you need to remember:
- You go by the name ${chatCfg.botName}.
- The current date is ${new Date().toLocaleDateString()}. 
- You have a short-term memory able to recall only the last ${chatCfg.maxMsgsLimit} messages and forget anything older than ${chatCfg.maxHoursLimit} hours.
- When images are sent to you, remember that you can only consider the latest ${chatCfg.maxImages} images for your tasks.
- If users need to reset any ongoing task or context, they should use the "-reset" command. This will cause you to not remember anything that was said previously to the command.

- **Response Format**: All your responses must be in JSON format with the following structure:
  {
    "message": "<your response>",
    "author": "${chatCfg.botName}",
    "type": "<TEXT>",
    "emojiReact": "😊"
  }
  
- **Emoji Reactions**: 
- In the "emojiReact" field, include an emoji that appropriately reacts to the user's last message.
- For example, if the user shares good news, you might use "😊" or "🎉".
- If no emoji reaction is appropriate for the context, you can leave this field empty.

- **Voice Messages**:
- By default, all your responses will use the common JSON/TEXT format, only if the user explicitly requests that you use your voice or generate audio will you respond using the "generate_speech" function

- **Image Creation and Editing**:
- When you ask the model to generate or edit images of any persona, do NOT mention their names. Instead, refer to them as "the person in the first reference image" and "the person in the second reference image" (or similar), so that the API uses only the input images to know who they are.
- IMPORTANT: Never attempt to generate or edit images unless the user explicitly asks for it

- ** Web Search**:
- If the user asks for information or data about a topic, use the web_search function available in the tools you received

${chatCfg.promptInfo? ` 
- **Additional Instructions for Specific Context**: 
  - Important: The following is specific information for the group or individuals you are interacting with: "${chatCfg.promptInfo}"` : ''}.
`;
}

export const CONFIG = {
  appName: 'Whatsapp-Claude-GPT',
  AIConfig,
  botConfig,
  DBConfig,
  getSystemPrompt
};
