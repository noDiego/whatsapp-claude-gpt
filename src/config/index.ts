import { config } from 'dotenv';

config();

// Configuration for OpenAI specific parameters
const openAI = {
  apiKey: process.env.OPENAI_API_KEY ?? '', // Your OpenAI API key for authentication against the OpenAI services
  chatCompletionModel: process.env.CHAT_COMPLETION_MODEL ?? 'gpt-4o-mini', // The model used by OpenAI for chat completions, can be changed to use different models. It is important to use a "vision" version to be able to identify images
  imageCreationModel: process.env.IMAGE_CREATION_MODEL ?? 'dall-e-3', // The model used by OpenAI for generating images based on text description
  speechModel: process.env.SPEECH_MODEL ?? 'tts-1', // The model used by OpenAI for generating speech from text
  speechVoice: process.env.SPEECH_VOICE ?? "nova", // Specifies the voice model to be used in speech synthesis,
  transcriptionLanguage: process.env.TRANSCRIPTION_LANGUAGE ?? "en" //The language of the input audio for transcriptions. Supplying the input language in [ISO-639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) format will improve accuracy and latency.
};

// Configuration for Anthropic specific parameters
const anthropic = {
  apiKey: process.env.CLAUDE_API_KEY ?? '', // Your CLAUDE_API_KEY key for authentication against the Anthropic services
  chatModel: process.env.CLAUDE_CHAT_MODEL ?? 'claude-3-sonnet-20240229',// The model used by Anthropic for chat completions
  maxCharacters: parseInt(process.env.MAX_CHARACTERS ?? '2000')
};

// General bot configuration parameters
const botConfig = {
  aiLanguage: process.env.AI_LANGUAGE ?? "OPENAI", // "ANTHROPIC" or "OPENAI". This setting is used only for chat completions. Image and audio generation are exclusively done using OpenAI.
  preferredLanguage: process.env.PREFERRED_LANGUAGE ?? '', // The default language for the bot. If not specified, the bot will use the language of the chat it is responding to
  botName: process.env.BOT_NAME ?? 'Roboto', // The name of the bot, used to identify when the bot is being addressed in group chats
  maxCharacters: parseInt(process.env.MAX_CHARACTERS ?? '2000'), //The maximum number of characters the chat model will output in a single completion
  maxImages: parseInt(process.env.MAX_IMAGES ?? '3'), // The maximum number of images the bot will process from the last received messages
  maxMsgsLimit: parseInt(process.env.MAX_MSGS_LIMIT ?? '30'), // The maximum number of recent messages the bot will consider for generating a coherent response
  maxHoursLimit: parseInt(process.env.MAX_HOURS_LIMIT ?? '24'), // The maximum hours a message's age can be for the bot to consider it in generating responses
  prompt: '', // The initial prompt for the bot, providing instructions on how the bot should behave; it's dynamically generated based on other config values
  imageCreationEnabled: process.env.IMAGE_CREATION_ENABLED === 'true', // (NEED OPENAI APIKEY) Enable or disable the bot's capability to generate images based on text descriptions.
  voiceMessagesEnabled: process.env.VOICE_MESSAGES_ENABLED === 'true', // (NEED OPENAI APIKEY) Enable or disable the bot's capability to respond with audio messages. When set to `true` the bot can send responses as voice messages based on user requests
  nodeCacheTime: parseInt(process.env.NODE_CACHE_TIME ?? '259200') // The cache duration for stored data, specified in seconds.This determines how long transcriptions and other data are kept in cache before they are considered stale and removed. Example value is 259200, which translates to 3 days.
};

// Dynamically generate the bot's initial prompt based on configuration parameters
botConfig.prompt = `You are a helpful and friendly assistant operating on WhatsApp. Your job is to assist users with various tasks, engaging in natural and helpful conversations. Here’s what you need to remember:
    - You go by the name ${botConfig.botName}. Always introduce yourself in the first interaction with any user.
    - You can analyze images.
    - Keep your responses concise and informative, you should not exceed the ${botConfig.maxCharacters} character limit. 
    - You have a short-term memory able to recall only the last ${botConfig.maxMsgsLimit} messages and forget anything older than ${botConfig.maxHoursLimit} hours. 
    - When images are sent to you, remember that you can only consider the latest ${botConfig.maxImages} images for your tasks.
    - If users need to reset any ongoing task or context, they should use the "-reset" command. This will cause you to not remember anything that was said previously to the command.
    ${botConfig.preferredLanguage?- `Preferably you will try to speak in ${botConfig.preferredLanguage}`:``}
    ${botConfig.voiceMessagesEnabled?'- **Response Format**: You will be able to receive and send messages that will be shown to the client as text or audio. You must always use the tag [Text] or [Audio] at the beginning of your messages.':'You must always use the tag [Text] at the beginning of your messages'}
    ${botConfig.voiceMessagesEnabled?'- **Default Setting**: By default, your messages will be [Text] unless the user has specifically requested that you respond with audio.':''}
    ${botConfig.voiceMessagesEnabled?'- **Summarize Audios**: All audio messages should be as brief and concise as possible.':''}
    ${botConfig.imageCreationEnabled?'- You can create images. If a user requests an image, guide them to use the command “-image <description>”. For example, respond with, “To create an image, please use the command \'-image a dancing dog\'.”':''}
    ${botConfig.imageCreationEnabled?'- Accuracy is key. If a command is misspelled, kindly notify the user of the mistake and suggest the correct command format. For instance, “It seems like there might be a typo in your command. Did you mean \'-image\' for generating images?”':''}`;

// The exported configuration which combines both OpenAI and general bot configurations
export const CONFIG = {
  appName: 'Whatsapp-Claude-GPT', // The name of the application, used for logging and identification purposes
  botConfig,
  openAI,
  anthropic
};
