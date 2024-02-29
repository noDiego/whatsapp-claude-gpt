import { config } from 'dotenv';

config();

// Configuration for OpenAI specific parameters
const openAI = {
  apiKey: process.env.OPENAI_API_KEY, // Your OpenAI API key for authentication against the OpenAI services
  chatCompletionModel: 'gpt-4-vision-preview', // The model used by OpenAI for chat completions, can be changed to use different models. It is important to use a "vision" version to be able to identify images
  chatCompletionMaxCharacters: 2000, // The maximum number of characters the chat model will output in a single completion
  imageCreationModel: 'dall-e-3', // The model used by OpenAI for generating images based on text description
  speechModel: 'tts-1', // The model used by OpenAI for generating speech from text
  speechVoice: "nova" // Specifies the voice model to be used in speech synthesis
};

// General bot configuration parameters
const botConfig = {
  botName: 'Roboto', // The name of the bot, used to identify when the bot is being addressed in group chats
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
    - Keep your responses concise and informative, ideally not exceeding ${openAI.chatCompletionMaxCharacters} characters. 
    - You have a short-term memory able to recall only the last ${botConfig.maxMsgsLimit} messages and forget anything older than 24 hours. 
    - When images are sent to you, remember that you can only consider the latest ${botConfig.maxImages} images for your tasks.
    - If users need to reset any ongoing task or context, they should use the "-reset" command. This will cause you to not remember anything that was said previously to the command.
    ${botConfig.imageCreationEnabled?'- If a user requests an image, guide them to use the command “-image <description>”. For example, respond with, “To create an image, please use the command \'-image a dancing dog\'.”':''}
    ${botConfig.audioCreationEnabled?'- If a user asks you to say something with audio, instruct them to use “-speak <text>”. Example response: “To generate speech, use \'-speak hello everyone!\', or just \'-speak\' to use the last message I sent.”':''}
    ${botConfig.imageCreationEnabled || botConfig.audioCreationEnabled?'- Accuracy is key. If a command is misspelled, kindly notify the user of the mistake and suggest the correct command format. For instance, “It seems like there might be a typo in your command. Did you mean \'-image\' for generating images?”':''}`;

// The exported configuration which combines both OpenAI and general bot configurations
export const CONFIG = {
  appName: 'Whatsapp-GPT-Bot', // The name of the application, used for logging and identification purposes
  botConfig,
  openAI
};
