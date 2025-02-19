import { config } from 'dotenv';

config();

const AIConfigs = {
  OPENAI: {
    apiKey:      process.env.OPENAI_API_KEY, // Your OpenAI API key for authentication against the OpenAI services
    chatModel:   process.env.CHAT_COMPLETION_MODEL ?? 'gpt-4o-mini', // The model used by OpenAI for chat completions, can be changed to use different models. It is important to use a "vision" version to be able to identify images
    imageModel:  process.env.IMAGE_CREATION_MODEL ?? 'dall-e-3', // The model used by OpenAI for generating images based on text description
    transcriptionModel:  process.env.TRANSCRIPTION_MODEL ?? 'whisper-1',
    speechModel: process.env.SPEECH_MODEL ?? 'tts-1', // The model used by OpenAI for generating speech from text
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
  aiLanguage: process.env.AI_LANGUAGE ?? "OPENAI", // "CLAUDE", "OPENAI", "QWEN", "DEEPSEEK" or "CUSTOM". This setting is used only for chat completions. Image and audio generation are exclusively done using OpenAI for now.
  preferredLanguage: process.env.PREFERRED_LANGUAGE ?? '', // The default language for the bot. If not specified, the bot will use the language of the chat it is responding to
  botName: process.env.BOT_NAME ?? 'Roboto', // The name of the bot, used to identify when the bot is being addressed in group chats
  maxCharacters: parseInt(process.env.MAX_CHARACTERS ?? '2000'), //The maximum number of characters the chat model will output in a single completion
  maxImages: parseInt(process.env.MAX_IMAGES ?? '3'), // The maximum number of images the bot will process from the last received messages
  maxMsgsLimit: parseInt(process.env.MAX_MSGS_LIMIT ?? '30'), // The maximum number of recent messages the bot will consider for generating a coherent response
  maxHoursLimit: parseInt(process.env.MAX_HOURS_LIMIT ?? '24'), // The maximum hours a message's age can be for the bot to consider it in generating responses
  imageCreationEnabled: process.env.IMAGE_CREATION_ENABLED === 'true', // (NEED OPENAI APIKEY) Enable or disable the bot's capability to generate images based on text descriptions.
  voiceMessagesEnabled: process.env.VOICE_MESSAGES_ENABLED === 'true', // (NEED OPENAI APIKEY) Enable or disable the bot's capability to respond with audio messages. When set to `true` the bot can send responses as voice messages based on user requests
  transcriptionLanguage: process.env.TRANSCRIPTION_LANGUAGE ?? "en", //The language of the input audio for transcriptions. Supplying the input language in [ISO-639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) format will improve accuracy and latency.
  nodeCacheTime: parseInt(process.env.NODE_CACHE_TIME ?? '259200'), // The cache duration for stored data, specified in seconds.This determines how long transcriptions and other data are kept in cache before they are considered stale and removed. Example value is 259200, which translates to 3 days.
  prompt: '', // The initial prompt for the bot, providing instructions on how the bot should behave; it's dynamically generated based on other config values
  promptInfo: process.env.PROMPT_INFO // You can use this to customize the bot's personality and provide context about the group or individuals for tailored interactions.
};

if(!AIConfigs.OPENAI.apiKey){
  botConfig.imageCreationEnabled = false;
  botConfig.voiceMessagesEnabled = false;
}

// Dynamically generate the bot's initial prompt based on configuration parameters
botConfig.prompt = `You are an assistant operating on WhatsApp. Your job is to assist users with various tasks, engaging in natural and helpful conversations. Here’s what you need to remember:
- You go by the name ${botConfig.botName}. Always introduce yourself in the first interaction with any user.
- The current date is ${new Date().toLocaleDateString()}. 
${botConfig.aiLanguage == 'DEEPSEEK'?'- You can\'t analyze images.':'You can analyze images'}
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

${botConfig.voiceMessagesEnabled ? `
- **Audio Messages**: 
  - You can send responses as audio. Use "type": "AUDIO" when responding with audio messages.
  - **Default Setting**: By default, your messages will be "TEXT" unless the user has specifically requested that you respond with audio.
  - **Summarize Audios**: All audio messages should be as brief and concise as possible.
` : `
- **Audio Messages Disabled**: 
  - All your responses must have "type": "TEXT" as audio messages are disabled.
`}

${botConfig.imageCreationEnabled ? `
- **Image Creation**: 
  - You can create images. If a user requests an image, guide them to use the command “-image <description>”. For example, respond with, “To create an image, please use the command '-image a dancing dog'.”
- **Command Accuracy**: 
  - Accuracy is key. If a command is misspelled, kindly notify the user of the mistake and suggest the correct command format. For instance, “It seems like there might be a typo in your command. Did you mean '-image' for generating images?”` : ``}

${botConfig.promptInfo ? ` 
- **Additional Instructions for Specific Context**: 
  - Important: The following is specific information for the group or individuals you are interacting with: "${botConfig.promptInfo}"` : ''}.
`;


// The exported configuration which combines both OpenAI and general bot configurations
export const CONFIG = {
  appName: 'Whatsapp-Claude-GPT', // The name of the application, used for logging and identification purposes
  botConfig,
  AIConfigs
};
