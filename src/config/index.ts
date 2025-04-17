import { config } from 'dotenv';
import { ChatCfg } from '../interfaces/chatconfig';
import { capitalize } from '../utils';

config();

const dbConfig = {
  user: String(process.env.PSQL_USER),
  password: String(process.env.PSQL_PASS),
  host: process.env.PSQL_HOST!,
  port: process.env.PSQL_PORT!,
  database: process.env.PSQL_DB!,
  schema: process.env.PSQL_SCHEMA!
}

const AIConfigs = {
  OPENAI: {
    apiKey:      process.env.OPENAI_API_KEY, // Your OpenAI API key for authentication against the OpenAI services
    chatModel:   process.env.CHAT_COMPLETION_MODEL ?? 'gpt-4.1', // The model used by OpenAI for chat completions, can be changed to use different models. It is important to use a "vision" version to be able to identify images
    imageModel:  process.env.IMAGE_CREATION_MODEL ?? 'dall-e-3', // The model used by OpenAI for generating images based on text description
    transcriptionModel:  process.env.TRANSCRIPTION_MODEL ?? 'gpt-4o-transcribe',
    speechModel: process.env.SPEECH_MODEL ?? 'gpt-4o-mini-tts', // The model used by OpenAI for generating speech from text
    speechVoice: process.env.SPEECH_VOICE ?? "nova" // Specifies the voice model to be used in speech synthesis
  },
  QWEN: {
    baseURL:     process.env.QWEN_BASEURL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', // The base URL for the QWEN AI service
    apiKey:      process.env.QWEN_API_KEY!, // The API key for the QWEN AI service
    chatModel:   process.env.QWEN_COMPLETION_MODEL ?? 'qwen2.5-vl-72b-instruct', // The chat model used by the QWEN AI service
  },
  DEEPSEEK: {
    baseURL:     process.env.DEEPSEEK_BASEURL ?? 'https://api.deepseek.com', // The base URL for the DEEPSEEK AI service
    apiKey:      process.env.DEEPSEEK_API_KEY!, // The API key for the DEEPSEEK AI service
    chatModel:   process.env.DEEPSEEK_COMPLETION_MODEL ?? 'deepseek-chat', // The chat model used by the DEEPSEEK AI service
  },
  CUSTOM: {
    baseURL:     process.env.CUSTOM_BASEURL!, // The base URL for the custom AI service
    apiKey:      process.env.CUSTOM_API_KEY!, // The API key for the custom AI service
    chatModel:   process.env.CUSTOM_COMPLETION_MODEL!, // The chat model used by the custom AI service
  },
  CLAUDE: {
    apiKey:      process.env.CLAUDE_API_KEY ?? '', // Your CLAUDE_API_KEY key for authentication against the Anthropic services
    chatModel:   process.env.CLAUDE_CHAT_MODEL ?? 'claude-3-sonnet-20240229',// The model used by Anthropic for chat completions
  }
}

// General bot configuration parameters
const botConfig = {
  adminNumber: process.env.ADMIN_NUMBER,
  restrictedNumbers: process.env.RESTRICTED_NUMBERS!.split(','),
  restrictedImageMessage: process.env.RESTRICTED_IMAGE_MESSAGE!,
  aiLanguage: process.env.AI_LANGUAGE ?? "OPENAI", // "CLAUDE", "OPENAI", "QWEN", "DEEPSEEK" or "CUSTOM". This setting is used only for chat completions. Image and audio generation are exclusively done using OpenAI for now.
  preferredLanguage: process.env.PREFERRED_LANGUAGE ?? '', // The default language for the bot. If not specified, the bot will use the language of the chat it is responding to
  botName: process.env.BOT_NAME ?? 'Roboto', // The name of the bot, used to identify when the bot is being addressed in group chats
  imageCreationEnabled: process.env.IMAGE_CREATION_ENABLED === 'true', // (NEED OPENAI APIKEY) Enable or disable the bot's capability to generate images based on text descriptions.
  voiceMessagesEnabled: process.env.VOICE_MESSAGES_ENABLED === 'true', // (NEED OPENAI APIKEY) Enable or disable the bot's capability to respond with audio messages. When set to `true` the bot can send responses as voice messages based on user requests
  transcriptionLanguage: process.env.TRANSCRIPTION_LANGUAGE ?? "en", //The language of the input audio for transcriptions. Supplying the input language in [ISO-639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) format will improve accuracy and latency.
  nodeCacheTime: parseInt(process.env.NODE_CACHE_TIME ?? '259200'), // The cache duration for stored data, specified in seconds.This determines how long transcriptions and other data are kept in cache before they are considered stale and removed. Example value is 259200, which translates to 3 days
};

const ElevenSpeech = {
  apiKey: process.env.ELEVEN_API_KEY!,
  model: process.env.ELEVEN_MODEL || 'eleven_multilingual_v2'
}

if(!AIConfigs.OPENAI.apiKey){
  botConfig.imageCreationEnabled = false;
  botConfig.voiceMessagesEnabled = false;
}

// Dynamically generate the bot's initial prompt based on configuration parameters
function buildPrompt(chatCfg: ChatCfg){
  const botname = capitalize(chatCfg.prompt_name);
  return `You are in a WhatsApp group conversation. These are your instructions:
- You go by the name ${capitalize(botname)}.
"- The current date is ${new Date().toLocaleDateString('es-CL')} (Chile)."
${botConfig.aiLanguage == 'DEEPSEEK'?'- You can\'t analyze images.':'You can analyze images'}
- Keep your responses concise and informative; you should not exceed the ${chatCfg.characterslimit} character limit.
- You have a short-term memory able to recall only the last ${chatCfg.limit} messages and forget anything older than ${chatCfg.hourslimit} hours.
- When images are sent to you, remember that you can only consider the latest ${chatCfg.maximages} images for your tasks.
- If users need to reset any ongoing task or context, they should use the "-reset" command. This will cause you to not remember anything that was said previously to the command.
${botConfig.preferredLanguage ? `- Preferably you will try to speak in ${botConfig.preferredLanguage}.` : ``}

- **Response Format**: All your responses must be in JSON format with the following structure:
  {
    "message": "<your response>",
    "author": "${botConfig.botName}",
    "type": "<TEXT or AUDIO>",
    "emoji_reaction": "😊",
    "voice_instructions": "<if type is AUDIO, provide instructions such as 'Speak in a friendly tone'>"
  }
  
  - Note: Only include the "voice_instructions" field when your "type" is "AUDIO". For "TEXT" responses, you may omit it.
  - Whenever you need to reference, cite, or display a website or link, never use Markdown format (e.g., [text](url)). Instead, always show the full URL as plain text, or use another appropriate format that does not involve Markdown.
  
- **Emoji Reactions**: 
- In the "emoji_reaction" field, include an emoji that appropriately reacts to the user's last message.
- For example, if the user shares good news, you might use "😊" or "🎉".
- If no emoji reaction is appropriate for the context, you can leave this field empty.

${botConfig.voiceMessagesEnabled ? `
- **Audio Messages**: 
  - You can send responses using your voice as audio. Use "type": "AUDIO" when responding with audio (voice) messages.
  - **Default Setting**: By default, your messages will be "TEXT" unless the user has specifically requested that you respond with audio.
  - **Content for Audio**: When using "type": "AUDIO", your "message" field must contain the FULL content to be converted to speech, not just a confirmation. For example, if a user asks for a joke in audio format, include the entire joke in the "message" field, not just "Here's a joke for you".
` : `
- **Audio Messages Disabled**: 
  - All your responses must have "type": "TEXT" as audio messages are disabled.
`}

${botConfig.imageCreationEnabled ? `
  - **Image Generation**:
    - When users request image generation, you must include "image_description" in your JSON response with a detailed prompt.
    - Your image prompts must follow these guidelines:
      1. Be highly detailed and specific (25-50 words)
      2. Avoid negative prompts or what NOT to include
      3. Use proper English for best results
    
    - **Example Format:**
      User: {"message": "Generate an image of a dog dancing","author": "user","type": "TEXT"}
      Bot: {
        "message": "I've created a playful dancing dog scene for you.",
        "author": "${botConfig.botName}",
        "type": "TEXT",
        "image_description": "A joyful Golden Retriever dancing on its hind legs in a sunlit forest clearing, wearing a tiny bow tie. Digital art style with warm lighting, front view, surrounded by musical notes and autumn leaves. Vibrant autumn colors with golden hour lighting."
      }` : ``}

${chatCfg.prompt_text ? ` 
- **Additional Instructions for Specific Context**: 
  - Important: The following is specific information for the group or individuals you are interacting with: "${chatCfg.prompt_text}"` : ''}.
`
}

// The exported configuration which combines both OpenAI and general bot configurations
export const CONFIG = {
  appName: 'Whatsapp-Claude-GPT', // The name of the application, used for logging and identification purposes
  botConfig,
  AIConfigs,
  dbConfig,
  buildPrompt,
  ElevenSpeech
};
