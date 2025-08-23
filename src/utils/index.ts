import logger from '../logger';
import { Chat, Message } from 'whatsapp-web.js';
import { Readable } from 'stream';
import { AIConfig, CONFIG } from '../config';
import { AIAnswer } from "../interfaces/ai-interfaces";

export function getFormattedDate(date?: Date) {
  const now = date || new Date();

  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');

  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  const offsetMinutes = now.getTimezoneOffset();
  const offsetSign = offsetMinutes > 0 ? '-' : '+';
  const absOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absOffsetMinutes / 60).toString().padStart(2, '0');
  const offsetMins = (absOffsetMinutes % 60).toString().padStart(2, '0');
  const offsetString = `${offsetSign}${offsetHours}:${offsetMins}`;

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdayShort = weekdays[now.getDay()];

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetString} (${weekdayShort})`;
}

export function logMessage(message: Message, chat: Chat) {
  const msgDate = new Date(message.timestamp * 1000);
  logger.info(
      `[ReceivedMessage] {msg:'${message.body}', author:${getAuthorId(message)}, isGroup:${chat.isGroup}, chatId:${chat.id._serialized}, grName:${chat.name}, date:'${getFormattedDate(msgDate)}'}`
  );
}

export function includeName(bodyMessage: string, name: string): boolean {
  const regex = new RegExp(`(^|\\s)${name}($|[!?.]|\\s|,\\s)`, 'i');
  return regex.test(bodyMessage);
}

export function removeNonAlphanumeric(str: string): string {
  if (!str) return str;
  const regex = /[^a-zA-Z0-9]/g;
  const normalized = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(regex, '');
}

export function parseCommand(input: string): { command?: string, commandMessage?: string } {
  const match = input.match(/^-(\S+)\s*(.*)/);
  if (!match) {
    return {commandMessage: input};
  }
  return {command: match[1].trim(), commandMessage: match[2].trim()};
}

export async function getUserName(message: Message) {
  const contactInfo = await message.getContact();
  const name = CONFIG.BotConfig.useContactNames? contactInfo.shortName || contactInfo.name || contactInfo.pushname || contactInfo.number :
      contactInfo.pushname || contactInfo.number;
  return removeNonAlphanumeric(name);
}

export function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

export function getUnsupportedMessage(type: string, body?: string) {
  const bodyStr = body ? `, body:"${body}"` : ``;
  const typeStr = `type:"${type}"`;
  return `<Unsupported message: {${typeStr}${bodyStr}}>`
}

export function configValidation() {
  function validateProvider(type: string, provider: string, config: any, configObject: any) {
    if (!config.apiKey) {
      const apiKeyEnvVar = getApiKeyEnvVarName(provider);
      logger.warn(`WARNING: ${provider} API key is missing when using ${provider} as ${type} provider.`);
      logger.warn(`The ${type} functionality will be automatically disabled.`);

      // Disable the functionality when API key is missing
      if (type === 'Image') {
        AIConfig.ImageConfig.enabled = false;
      } else if (type === 'Speech') {
        AIConfig.SpeechConfig.enabled = false;
      } else if (type === 'Transcription') {
        AIConfig.TranscriptionConfig.enabled = false;
      } else if (type === 'Chat') {
        // For chat, we don't disable but exit since it's essential
        logger.error(`ERROR: ${provider} API key is required when using ${provider} as ${type} provider.`);
        logger.error(`Please set the ${apiKeyEnvVar} environment variable in your .env file.`);
        process.exit(1);
      }

      return false;
    }

    if (provider === 'CUSTOM') {
      if (!config.baseURL) {
        logger.error(`ERROR: CUSTOM_BASEURL is required when using CUSTOM as ${type} provider.`);
        logger.error(`Please set the CUSTOM_BASEURL environment variable in your .env file.`);
        process.exit(1);
      }

      if (!config.model) {
        const modelEnvVar = getModelEnvVarName('CUSTOM', type);
        logger.error(`ERROR: CUSTOM model configuration is required when using CUSTOM as ${type} provider.`);
        logger.error(`Please set the ${modelEnvVar} environment variable in your .env file.`);
        process.exit(1);
      }
    }

    return true;
  }

  function getApiKeyEnvVarName(provider: string): string {
    const envVarMapping = {
      'OPENAI': 'OPENAI_API_KEY',
      'CLAUDE': 'CLAUDE_API_KEY',
      'QWEN': 'QWEN_API_KEY',
      'DEEPSEEK': 'DEEPSEEK_API_KEY',
      'ELEVENLABS': 'ELEVENLABS_API_KEY',
      'DEEPINFRA': 'DEEPINFRA_API_KEY',
      'CUSTOM': 'CUSTOM_API_KEY'
    };

    return envVarMapping[provider] || `${provider}_API_KEY`;
  }

  function getModelEnvVarName(provider: string, type: string): string {
    const typeMapping = {
      'Chat': 'COMPLETION_MODEL',
      'Image': 'IMAGE_MODEL',
      'Transcription': 'TRANSCRIPTION_MODEL',
      'Speech': 'SPEECH_MODEL'
    };

    if (provider === 'CUSTOM') {
      return 'CUSTOM_' + typeMapping[type];
    } else {
      return `${provider}_${typeMapping[type]}`;
    }
  }

  // Validate chat provider (required)
  validateProvider('Chat', AIConfig.ChatConfig.provider, AIConfig.ChatConfig, AIConfig.ChatConfig);

  // Validate optional providers
  if (AIConfig.ImageConfig.enabled) {
    validateProvider('Image', AIConfig.ImageConfig.provider, AIConfig.ImageConfig, AIConfig);
  }

  // If transcription is enabled, validate it (or disable if API key is missing)
  if (AIConfig.TranscriptionConfig.enabled) {
    validateProvider('Transcription', AIConfig.TranscriptionConfig.provider, AIConfig.TranscriptionConfig, AIConfig);
  }

  // If speech is enabled, validate it (or disable if API key is missing)
  if (AIConfig.SpeechConfig.enabled) {
    validateProvider('Speech', AIConfig.SpeechConfig.provider, AIConfig.SpeechConfig, AIConfig);
  }

  // If both transcription or speech are disabled, disable voice messages entirely
  if (!AIConfig.TranscriptionConfig.enabled || !AIConfig.SpeechConfig.enabled) {
    AIConfig.TranscriptionConfig.enabled = false;
    AIConfig.SpeechConfig.enabled = false;
    logger.warn('WARNING: Voice message handling has been disabled because either transcription or speech service is missing an API key.');
  }

  const { provider: chatProvider } = AIConfig.ChatConfig;
  if (!['OPENAI', 'CLAUDE', 'QWEN', 'DEEPSEEK', 'DEEPINFRA', 'CUSTOM'].includes(chatProvider)) {
    logger.error(`ERROR: Invalid CHAT_PROVIDER: ${chatProvider}`);
    logger.error(`Valid options are: OPENAI, CLAUDE, QWEN, DEEPSEEK, DEEPINFRA, CUSTOM`);
    logger.error(`Please set a valid CHAT_PROVIDER in your .env file.`);
    process.exit(1);
  }

  if (AIConfig.ImageConfig.enabled) {
    const { provider: imageProvider } = AIConfig.ImageConfig;
    if (!['OPENAI', 'DEEPINFRA'].includes(imageProvider)) {
      logger.error(`ERROR: Invalid IMAGE_PROVIDER: ${imageProvider}`);
      logger.error(`Valid options are: OPENAI, DEEPINFRA`);
      logger.error(`Please set a valid IMAGE_PROVIDER in your .env file.`);
      process.exit(1);
    }
  }

  if (AIConfig.TranscriptionConfig.enabled) {
    const { provider: transcriptionProvider } = AIConfig.TranscriptionConfig;
    if (!['OPENAI', 'DEEPINFRA'].includes(transcriptionProvider)) {
      logger.error(`ERROR: Invalid TRANSCRIPTION_PROVIDER: ${transcriptionProvider}`);
      logger.error(`Valid options are: OPENAI, DEEPINFRA`);
      logger.error(`Please set a valid TRANSCRIPTION_PROVIDER in your .env file.`);
      process.exit(1);
    }
  }

  if (AIConfig.SpeechConfig.enabled) {
    const { provider: speechProvider } = AIConfig.SpeechConfig;
    if (!['OPENAI', 'ELEVENLABS'].includes(speechProvider)) {
      logger.error(`ERROR: Invalid SPEECH_PROVIDER: ${speechProvider}`);
      logger.error(`Valid options are: OPENAI, ELEVENLABS`);
      logger.error(`Please set a valid SPEECH_PROVIDER in your .env file.`);
      process.exit(1);
    }
  }

  logger.info('Configuration validation successful.');
}

export function extractAnswer(input: string, botName: string): AIAnswer {

  // Remove <think> tags if they exist
  const regex = /<think>[\s\S]*?<\/think>/g;
  let cleanedInput = input.replace(regex, '').trim();

  if (!cleanedInput || typeof cleanedInput !== 'string') {
    return null;
  }

  const fixJsonString = (jsonStr: string): string => {
    let fixed = '';
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];

      if (escapeNext) {
        fixed += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        fixed += char;
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        fixed += char;
        continue;
      }

      if (inString) {
        switch (char) {
          case '\n':
            fixed += '\\n';
            break;
          case '\r':
            fixed += '\\r';
            break;
          case '\t':
            fixed += '\\t';
            break;
          case '\b':
            fixed += '\\b';
            break;
          case '\f':
            fixed += '\\f';
            break;
          default:
            fixed += char;
        }
      } else {
        fixed += char;
      }
    }

    return fixed;
  };

  // Attempt 1: Parse directly as JSON with fixing
  try {
    const fixed = fixJsonString(cleanedInput);
    const parsed = JSON.parse(fixed);
    if (parsed && typeof parsed === 'object' && parsed.message !== undefined) {
      return parsed;
    }
  } catch (e) {
    logger.debug(`[extractAnswer] Direct JSON parsing failed: ${e.message}`);
  }

  // Attempt 2: Find JSON embedded in text
  const jsonRegex = /\{[\s\S]*?\}/;
  const match = cleanedInput.match(jsonRegex);

  if (match) {
    try {
      const fixed = fixJsonString(match[0]);
      logger.debug(`[extractAnswer] Trying to parse regex-extracted fixed JSON: ${fixed.substring(0, 200)}...`);
      const parsed = JSON.parse(fixed);
      if (parsed && typeof parsed === 'object' && parsed.message !== undefined) {
        return parsed;
      }
    } catch (e) {
      logger.debug(`[extractAnswer] Regex extracted JSON parsing failed: ${e.message}`);
    }
  }

  // Attempt 3: Enhanced bracket matching with fixing
  const startMatch = cleanedInput.match(/[{\[]/);
  if (!startMatch) {
    logger.debug("[extractAnswer] Valid JSON start character not found, returning raw text");
    return {message: cleanedInput, author: botName, type: 'text'};
  }

  try {
    const startIndex = startMatch.index;
    let endIndex = cleanedInput.length;
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIndex; i < cleanedInput.length; i++) {
      const char = cleanedInput[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') openBraces++;
      if (char === '}') openBraces--;
      if (char === '[') openBrackets++;
      if (char === ']') openBrackets--;

      if (i >= startIndex && openBraces === 0 && openBrackets === 0) {
        if (startMatch[0] === '{' && char === '}') {
          endIndex = i + 1;
          break;
        }
        if (startMatch[0] === '[' && char === ']') {
          endIndex = i + 1;
          break;
        }
      }
    }

    let jsonString = cleanedInput.substring(startIndex, endIndex);
    jsonString = fixJsonString(jsonString);

    logger.debug(`[extractAnswer] Attempting to parse bracket-matched fixed JSON: ${jsonString.substring(0, 200)}...`);

    const parsed = JSON.parse(jsonString);
    if (parsed && typeof parsed === 'object' && parsed.message !== undefined) {
      return parsed;
    }

  } catch (e) {
    logger.debug(`[extractAnswer] JSON parsing failed: ${e.message}`);
  }

  // Fallback: return as plain text
  logger.debug("[extractAnswer] All parsing attempts failed, returning as plain text");
  return {message: cleanedInput, author: botName, type: 'text'};
}

export function logConfigInfo() {
  logger.info('========== CONFIGURATION SUMMARY ==========');

  // Bot general information
  logger.info(`📝 BOT CONFIGURATION:`);
  logger.info(`• Bot name: ${CONFIG.BotConfig.botName}`);
  logger.info(`• Response character limit: ${CONFIG.BotConfig.maxCharacters}`);
  logger.info(`• Maximum messages considered: ${CONFIG.BotConfig.maxMsgsLimit}`);
  logger.info(`• Maximum message age: ${CONFIG.BotConfig.maxHoursLimit} hours`);
  logger.info(`• Maximum images processed: ${CONFIG.BotConfig.maxImages}`);

  // Chat provider and model
  logger.info(`🤖 CHAT PROVIDER:`);
  logger.info(`• Provider: ${AIConfig.ChatConfig.provider}`);
  logger.info(`• Model: ${AIConfig.ChatConfig.model}`);
  if (AIConfig.ChatConfig.baseURL && AIConfig.ChatConfig.provider !== 'OPENAI' && AIConfig.ChatConfig.provider !== 'CLAUDE') {
    logger.info(`• Base URL: ${AIConfig.ChatConfig.baseURL}`);
  }
  logger.info(`• Image analysis: ${AIConfig.ChatConfig.analyzeImageDisabled ? 'Disabled' : 'Enabled'}`);

  // Image configuration
  logger.info(`🖼️ IMAGE GENERATION:`);
  if (AIConfig.ImageConfig.enabled) {
    logger.info(`• Status: Enabled`);
    logger.info(`• Provider: ${AIConfig.ImageConfig.provider}`);
    logger.info(`• Model: ${AIConfig.ImageConfig.model}`);
    if (AIConfig.ImageConfig.baseURL && AIConfig.ImageConfig.provider !== 'OPENAI') {
      logger.info(`• Base URL: ${AIConfig.ImageConfig.baseURL}`);
    }
  } else {
    logger.info(`• Status: Disabled`);
  }

  // Voice message handling
  logger.info(`🎤 VOICE MESSAGE HANDLING:`);
  if (AIConfig.TranscriptionConfig.enabled && AIConfig.SpeechConfig.enabled) {
    logger.info(`• Status: Enabled`);

    // Transcription (Speech-to-Text)
    logger.info(`TRANSCRIPTION (Speech-to-Text):`);
    logger.info(`  • Provider: ${AIConfig.TranscriptionConfig.provider}`);
    logger.info(`  • Model: ${AIConfig.TranscriptionConfig.model}`);
    logger.info(`  • Language: ${CONFIG.BotConfig.transcriptionLanguage}`);
    if (AIConfig.TranscriptionConfig.baseURL && AIConfig.TranscriptionConfig.provider !== 'OPENAI') {
      logger.info(`  • Base URL: ${AIConfig.TranscriptionConfig.baseURL}`);
    }

    // Speech (Text-to-Speech)
    logger.info(` SPEECH (Text-to-Speech):`);
    logger.info(`  • Provider: ${AIConfig.SpeechConfig.provider}`);
    logger.info(`  • Model: ${AIConfig.SpeechConfig.model}`);
    logger.info(`  • Voice: ${AIConfig.SpeechConfig.voice}`);
    if (AIConfig.SpeechConfig.baseURL && AIConfig.SpeechConfig.provider !== 'OPENAI' && AIConfig.SpeechConfig.provider !== 'ELEVENLABS') {
      logger.info(`  • Base URL: ${AIConfig.SpeechConfig.baseURL}`);
    }
  } else {
    logger.info(`• Status: Disabled`);
  }

  // Additional information if preferred language is set
  if (CONFIG.BotConfig.preferredLanguage) {
    logger.info(`🌐 LANGUAGE PREFERENCES:`);
    logger.info(`• Preferred language: ${CONFIG.BotConfig.preferredLanguage}`);
  }

  logger.info('===========================================');
}

export function sanitizeLogImages(str: string) {
  return str.replace(/(data:image\/[a-zA-Z0-9+.-]+;base64,)[A-Za-z0-9+/=]+/g, '$1...');
}

export function parseIfJson(input: any) {
  if (typeof input === 'object' && input !== null) {
    return input;
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch (e) {
      return null;
    }
  }
  return null;
}

export function getAuthorId(wspMsg: Message): string{
  return wspMsg.author || wspMsg.id?.remote || (wspMsg.id as any)?.participant;
}

export function addSeconds(date: Date, seconds: number): Date {
  const result = new Date(date);
  result.setSeconds(result.getSeconds() + seconds);
  return result;
}

export function convertCompletionsToolsToResponses(tools) {
  if (!Array.isArray(tools)) {
    throw new TypeError("tools must be an array");
  }

  return tools.map((tool, idx) => {
    if (!tool || typeof tool !== "object") return tool;

    if (tool.type !== "function") return tool;

    if (!tool.function && tool.name && tool.parameters) {
      return tool;
    }

    const fn = tool.function || {};

    const out = {
      type: "function",
      name: fn.name ?? tool.name,
      description: fn.description ?? tool.description,
      parameters: fn.parameters ?? tool.parameters
    } as any;

    if (typeof fn.strict !== "undefined") out.strict = fn.strict;
    else if (typeof tool.strict !== "undefined") out.strict = tool.strict;

    for (const k in tool) {
      if (["type", "function", "name", "description", "parameters", "strict"].includes(k)) continue;
      if (typeof out[k] === "undefined") out[k] = tool[k];
    }

    for (const k in fn) {
      if (["name", "description", "parameters", "strict"].includes(k)) continue;
      if (typeof out[k] === "undefined") out[k] = fn[k];
    }

    if (!out.name) {
      console.warn(`Tool at index ${idx} is missing a function name after conversion.`);
    }
    if (!out.parameters) {
      console.warn(`Tool "${out.name || idx}" is missing parameters schema after conversion.`);
    }

    return out;
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}