import { config } from 'dotenv';

config();

// Configuration for OpenAI specific parameters
const openAI = {
  apiKey: process.env.OPENAI_API_KEY, // Your OpenAI API key for authentication against the OpenAI services
  chatCompletionModel: 'gpt-4-vision-preview', // The model used by OpenAI for chat completions, can be changed to use different models. It is important to use a "vision" version to be able to identify images
  imageCreationModel: 'dall-e-3', // The model used by OpenAI for generating images based on text description
  speechModel: 'tts-1', // The model used by OpenAI for generating speech from text
  speechVoice: "nova" // Specifies the voice model to be used in speech synthesis
};

// Configuration for Anthropic specific parameters
const anthropic = {
  apiKey: process.env.CLAUDE_API_KEY, // Your CLAUDE_API_KEY key for authentication against the Anthropic services
  chatModel: 'claude-3-sonnet-20240229',// The model used by Anthropic for chat completions
  maxCharacters: 2000
};

// General bot configuration parameters
const botConfig = {
  aiLanguage: process.env.AI_LANGUAGE || "ANTHROPIC", // "ANTHROPIC" or "OPENAI". This setting is used only for chat completions. Image and audio generation are exclusively done using OpenAI.
  botName: 'Roboto', // The name of the bot, used to identify when the bot is being addressed in group chats
  maxCharacters: 2000, //The maximum number of characters the chat model will output in a single completion
  maxImages: 3, // The maximum number of images the bot will process from the last received messages
  maxMsgsLimit: 30, // The maximum number of recent messages the bot will consider for generating a coherent response
  maxHoursLimit: 24, // The maximum hours a message's age can be for the bot to consider it in generating responses
  prompt: '', // The initial prompt for the bot, providing instructions on how the bot should behave; it's dynamically generated based on other config values
  imageCreationEnabled: true, // Enable or disable the bot's capability to generate images based on text descriptions
  audioCreationEnabled: true // Enable or disable the bot's capability to generate speech audio from text
};

// Dynamically generate the bot's initial prompt based on configuration parameters
botConfig.prompt = `You are a helpful and friendly assistant operating on WhatsApp. Your job is to assist users with various tasks, engaging in natural and helpful conversations. Here’s what you need to remember:
    - You go by the name ${botConfig.botName}. Always introduce yourself in the first interaction with any user.
    - Keep your responses concise and informative, you should not exceed the ${botConfig.maxCharacters} character limit. 
    - You have a short-term memory able to recall only the last ${botConfig.maxMsgsLimit} messages and forget anything older than ${botConfig.maxHoursLimit} hours. 
    - When images are sent to you, remember that you can only consider the latest ${botConfig.maxImages} images for your tasks.
    - If users need to reset any ongoing task or context, they should use the "-reset" command. This will cause you to not remember anything that was said previously to the command.
    ${botConfig.imageCreationEnabled?'- You can create images. If a user requests an image, guide them to use the command “-image <description>”. For example, respond with, “To create an image, please use the command \'-image a dancing dog\'.”':''}
    ${botConfig.audioCreationEnabled?'- You can create audios. If a user asks you to say something with audio, instruct them to use “-speak <text>” to create an audio of a text, or they can just use "-speak" to create an audio of the bot\'s last response. Example response: “To generate speech, use \'-speak hello everyone!\', or just \'-speak\' to use the last message I sent.”':''}
    ${botConfig.imageCreationEnabled || botConfig.audioCreationEnabled?'- Accuracy is key. If a command is misspelled, kindly notify the user of the mistake and suggest the correct command format. For instance, “It seems like there might be a typo in your command. Did you mean \'-image\' for generating images?”':''}`;

// The exported configuration which combines both OpenAI and general bot configurations
export const CONFIG = {
  appName: 'Whatsapp-Claude-GPT', // The name of the application, used for logging and identification purposes
  botConfig,
  openAI,
  anthropic
};
