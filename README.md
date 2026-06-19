# WhatsApp-Claude-GPT

WhatsApp-Claude-GPT is a WhatsApp chatbot that supports multiple AI providers for chat, optional image generation/editing, and voice (speech-to-text and text-to-speech). It’s built for natural, contextual conversations and can now also handle reminders and personalized memory.

## Supported AI Providers

- **OpenAI**: Chat, Image Generation, Voice (TTS/STT)
- **Anthropic Claude**: Chat
- **DeepSeek**: Chat
- **Deepinfra**: Chat, Image Generation, Transcription
- **QWEN**: Chat
- **ElevenLabs**: Text-to-Speech


## What’s New in 1.4.0

- **Reminders**: Ask the bot to schedule reminders (one-time or recurring) in natural language. The bot will send a WhatsApp message at the scheduled time.
- **Unified Memory**: The bot can remember personal and group details to make conversations more personalized. This can be disabled to save tokens (see “Memory & Token Usage”).
- **GPT‑5 Support**: Works with OpenAI’s gpt-5 for chat.
- **Image Edition**: Edit/transform images using references (OpenAI-only)
- Per-chat configuration and quality-of-life improvements.

## What's New in 1.4.6

- **Privacy & Log Sanitization**: All log output is now sanitized to redact API keys, Bearer tokens, phone numbers, and base64 image data. See [Privacy & Data Retention](#privacy--data-retention).
- **OpenAI `store` opt-out by default**: API requests now set `store: false` by default. Set `OPENAI_STORE=true` in your `.env` to re-enable server-side conversation storage.
- **Rate Limiting**: New optional per-chat/per-author rate limiting to prevent abuse. Configure with `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_SEC`. See [Rate Limiting](#rate-limiting).
- **Granular Cache TTLs**: Fine-tune cache expiration independently for messages (`MESSAGE_CACHE_TTL`), downloaded media (`MEDIA_CACHE_TTL`), and voice transcriptions (`TRANSCRIPTION_CACHE_TTL`).
- **Configurable `CLAUDE_MAX_TOKENS`**: Claude's `max_tokens` is now configurable via env var (default: 2048).
- **Puppeteer sandbox is now opt-in** ⚠️: `--no-sandbox` is **no longer enabled by default**. Docker/CI users must set `PUPPETEER_NO_SANDBOX=true`. See [Docker / Puppeteer Note](#docker--puppeteer-note).
- **Safer env parsing**: Numeric environment variables are now validated with min/max ranges. Invalid values produce a warning and fall back to defaults instead of crashing.
- **Provider validation**: Invalid provider names (e.g., a typo in `CHAT_PROVIDER`) now produce a clear error message and exit, instead of crashing with an undefined property error.
- **Stability improvements**:
  - Message processing per chat now uses a deterministic promise queue (replaces polling-based locking).
  - Reminder checker starts only after the WhatsApp client is ready, prevents overlapping runs, and stops gracefully on shutdown.
  - Global `unhandledRejection` and `uncaughtException` handlers prevent silent crashes.
  - Restricted numbers are now also blocked from running bot commands.
- **Tests**: Added unit tests for core utilities (`extractAnswer`, `includeName`, `sanitizeForLog`, `messageConversion`, `recurrence`) and new npm scripts `npm test` / `npm run typecheck:strict`.
- **Bug fixes**:
  - `includeName` now escapes special regex characters in bot names and handles empty inputs.
  - `canEditImages` now correctly checks the image provider instead of the chat provider.
  - Database migration to make `user_memories.real_name` nullable (prevents crashes for users without a stored name).


## Key Features

- **Automatic Responses**: Generates coherent and contextual responses to messages
- **Image Creation**:
  - Generate images from text (OpenAI/Deepinfra).
  - Edit/transform images using references (OpenAI-only).
- **Reminders**: Create, list, update, delete, deactivate, and reactivate reminders (including recurring reminders).
- **Memory** (optional): Remembers user/group info for more personalized replies. Can be turned off to reduce token usage.
- **Voice Interaction**: Understands voice messages and can respond with voice messages
- **Group Interaction**: Responds in groups when its name is mentioned (e.g., "Hi Roboto, how are you?")
- **Context Management**: Tracks recent messages for context with customizable limits
- **Per-Chat Configuration**: Customize the bot's personality and name per chat or group
- **Multi-Provider Support**: Use different AI providers for different features
- **Web Searches (OpenAI Only)**: Can search information on the internet to generate its responses

## Requirements

Before initializing the bot, make sure you have [Node.js](https://nodejs.org/en/download/) installed.
(It was tested with Node v22.14.0)

## Quick Setup

1. Clone the repository and navigate to the project directory:
   ```
   git clone https://github.com/noDiego/whatsapp-claude-gpt.git
   cd whatsapp-claude-gpt
   ```

2. Install the project dependencies:
   ```
   npm install
   ```

3. Copy `.env.example` to `.env` and configure your API keys:
   ```
   cp .env.example .env
   ```

4. Edit the `.env` file with your API keys and preferences. At a minimum, the OpenAI API key must be set.

OPENAI_API_KEY=your_openai_api_key

5. Start the bot:
   ```
   npm run start
   ```

6. Upon startup, the bot will display a QR code in the terminal. Scan this QR code using the WhatsApp application on your mobile phone to link the bot to your WhatsApp account.

> **Note**: The WhatsApp account that scans the QR code will be sending all bot responses. Consider using a separate phone number for the bot.
This way, your personal WhatsApp account remains separate from the bot's activities, and you can interact with the bot just like any other contact.
>

## Reproducible Builds & Validation

This project uses `package-lock.json` (lockfileVersion 3) to guarantee reproducible dependency trees across environments. Running `npm install` with the lockfile present will install the exact versions resolved and tested.

- **Regenerate lockfile** (after changing `package.json`):
  ```
  npm install --package-lock-only
  ```
- **Build validation** (TypeScript compilation):
  ```
  npm run build
  ```
- **Security audit** (reports vulnerabilities without modifying dependencies):
  ```
  npm audit
  ```
- **Run tests** (unit tests for core utilities):
  ```
  npm test
  ```
- **Strict type-check** (stricter TypeScript validation without emitting):
  ```
  npm run typecheck:strict
  ```

The lockfile should be committed and kept up to date. Dependency upgrades should be reviewed in a separate PR or change — do not run `npm audit fix` or `npm update` without explicit review, as it may introduce breaking changes.

### Dependency Notes

- **`whatsapp-web.js`** is pinned to a specific commit (`2dc9466`) instead of tracking the `#main` branch, to ensure reproducible installs. Upstream upgrades should be reviewed and tested in a separate PR.
- **`drizzle-orm`** is currently at a beta version (`1.0.0-beta.21`). Any future upgrade must be validated against the memory and reminder queries (`src/services/memory-service.ts`, `src/services/reminder-service.ts`) as the ORM API may change between beta releases.

## Basic Configuration

At minimum, you need an API key for one of the supported AI providers. For basic usage with OpenAI:

```
OPENAI_API_KEY=your_api_key
BOT_NAME=Roboto
IMAGE_CREATION_ENABLED=true
VOICE_MESSAGES_ENABLED=true
MEMORIES_ENABLED=true
```

- You can get your OpenAI APIKey here: [OpenAI API Keys](https://platform.openai.com/account/api-keys)

## Using the Bot

### Chatting

- **Direct chat**: Simply send a message to the bot
- **Group chat**: Mention the bot's name (e.g., "Hey Roboto, what's the weather today?")


### Reminders (natural language)
Ask the bot to:
- “Remind me tomorrow at 9am to pay the bills.”
- “Set a reminder in 2 hours to stretch.”
- “Every Monday at 8am remind me about the team standup.”
- “List my reminders.”
- “Deactivate that reminder.” / “Reactivate the meeting reminder.”

It supports:
- One-time reminders
- Recurrence: minutes, daily, weekly, monthly
- Listing, updating, deleting, deactivating/reactivating

The bot manages IDs behind the scenes. If needed, it will list reminders to identify the right one to update or delete.

### Memory & Token Usage
The bot can remember personal and group details (e.g., age, job, interests, running jokes) to make conversations more helpful over time.

- To reduce token usage, disable memory:
  - MEMORIES_ENABLED=false in your .env
- With memory disabled:
  - The model won’t autonomously store or fetch memories.
  - Manual memory commands still work to show or clear what’s stored.
- The bot avoids saving raw voice transcription content as personal memory.

Memory commands you can type:
- -memory show
- -memory clear
- -memory group (in group chats)
- -memory cleargroup (in group chats)

### Privacy & Data Retention

The bot logs are sanitized to avoid exposing API keys, tokens, phone numbers, or raw user content. All sensitive patterns (Bearer tokens, `xi-api-key`, cookies, etc.) are redacted before logging.

- **OpenAI server-side storage** (`OPENAI_STORE`): By default, `store` is set to `false` in API requests, so OpenAI does not retain your conversations on their servers. If you need server-side storage (e.g., for compliance or debugging via the OpenAI dashboard), set `OPENAI_STORE=true` in your `.env` file.
- **SQLite database** (`roboto.sqlite`): Contains reminders, chat configurations, and memories. Since the database is not encrypted, restrict file permissions (`chmod 600 roboto.sqlite`) and ensure the host volume is secured. For maximum privacy, periodically clear old records using the `-memory clear` / `-memory cleargroup` commands.

### Rate Limiting

Optional per-chat (groups) or per-author (direct chats) rate limiting prevents a single user or chat from overwhelming the AI backend. Disabled by default.

- `RATE_LIMIT_MAX=0` — Maximum AI requests allowed per sliding window. `0` disables rate limiting (default).
- `RATE_LIMIT_WINDOW_SEC=60` — Sliding window duration in seconds (default: 60).

When rate limiting is active, messages that exceed the limit are silently dropped (no error is sent to the user). Admin numbers (configured via `ADMIN_NUMBERS`) bypass rate limiting.

### Using `-chatconfig` Command

The `-chatconfig` command lets you customize the bot's behavior for a specific chat or group:

```
-chatconfig [subcommand] [value]
```

Available subcommands:

- **prompt**: Sets a custom personality/prompt for the current chat
  ```
  -chatconfig prompt You are a helpful assistant who specializes in science topics
  ```

- **botname**: Changes the bot's name in the current chat
  ```
  -chatconfig botname ScienceBot
  ```

- **remove**: Removes custom configurations for the current chat
  ```
  -chatconfig remove
  ```

- **show**: Displays the current custom configuration
  ```
  -chatconfig show
  ```

In groups, only administrators can use the `-chatconfig` command.

Example use case: You can have the bot respond to "Roboto" in your personal chat, but respond to "Teacher" in an educational group with a more formal personality.

### Images
- Generation: Ask naturally (“Create a logo with a minimalist fox in orange and black”).
- Editing/Transformations (OpenAI-only): Send an image and ask the bot to modify it (“Make the background transparent,” “Replace the sky with a sunset,” etc.). The bot will use the reference image(s) you sent most recently.

Example (OpenAI-only image editing):

<img src="https://i.imgur.com/ANIoWue.jpeg" width="650">

### Voice
- Ask the bot to respond with audio:
  - “Please respond with an audio message.”
  - “Can you say this as an audio?”
- The bot also understands voice notes you send and will include them in context.

Example:
<img src="https://i.imgur.com/hvmd9z5.jpg" width="650">

### Resetting Chat Context with `-reset`

The `-reset` command is designed to clear the chatbot's current conversation context. When you issue this command, it effectively "forgets" the messages that have been processed so far, starting fresh as if the conversation with the user had just begun. This can be particularly useful in scenarios where the conversation has diverged significantly from its original intent or when you wish to start a new topic without the chatbot attempting to maintain continuity with previous messages.

To use the `-reset` command, simply type and send:
```
-reset
```

This command has no additional parameters. Once sent, any subsequent messages will be treated as the beginning of a new conversation, without consideration for what was discussed previously. This can enhance the relevancy and accuracy of the chatbot's responses moving forward.


## Configuration with .env File

#### Simple Example Using OpenAI for all features:

By default, the bot uses OpenAI for all features. A basic configuration looks like this:

``` 
## OPENAI CONFIG
OPENAI_API_KEY=your_api_key
OPENAI_COMPLETION_MODEL=gpt-4o-mini   # Model for chat completions
OPENAI_IMAGE_MODEL=dall-e-3           # Model for image generation
OPENAI_TRANSCRIPTION_MODEL=whisper-1  # Model for transcriptions (speech-to-text
OPENAI_SPEECH_MODEL=tts-1             # Model for speech synthesis
OPENAI_SPEECH_VOICE=nova              # Voice model for speech synthesis

# BOT CONFIGURATION
PREFERRED_LANGUAGE=                   # Default language for bot responses 
MAX_CHARACTERS=2000                   # Maximum characters per response
BOT_NAME=Roboto                       # Name of the bot to be used in responses
MAX_IMAGES=3                          # Maximum number of images to generate at once
MAX_MSGS_LIMIT=30                     # Maximum number of messages to keep in context
MAX_HOURS_LIMIT=24                    # Maximum time window for message context
NODE_CACHE_TIME=259200                # Caching time in seconds for transcribed message data
TRANSCRIPTION_LANGUAGE=en             # Default language for voice transcription
MEMORIES_ENABLED=true                 # Enable memory feature

## FEATURES
IMAGE_CREATION_ENABLED=true           # Enable image creation
VOICE_MESSAGES_ENABLED=true           # Enable voice responses

# You can use this to customize the default bot's personality and information (Or it can be customized using -chatconfig)
PROMPT_INFO="You should use a casual tone with plenty of emojis."
```

This basic configuration is all you need to get started. The bot will use OpenAI for all services.

## Advanced Provider Configuration (optional)

You can mix different providers per capability (chat, images, speech, transcription). Set these in .env if you need them:

- CHAT_PROVIDER=[OPENAI|CLAUDE|DEEPSEEK|DEEPINFRA|QWEN|CUSTOM]
- IMAGE_PROVIDER=[OPENAI|DEEPINFRA]
- SPEECH_PROVIDER=[OPENAI|ELEVENLABS]
- TRANSCRIPTION_PROVIDER=[OPENAI|DEEPINFRA]

Provide the corresponding API keys and model names per provider. See .env.full-example for a comprehensive template.

Notes:
- Web Search and Image Editing are OpenAI-only features.
- If an API key for a non-essential capability is missing, that capability is disabled automatically.

## Advanced Configuration .env Options

For advanced users, you can customize which provider handles each type of service. Set these variables in your `.env` file:

#### Full example:
```
CHAT_PROVIDER=OPENAI                          # Which provider to use for chat/text completion (OPENAI, CLAUDE, DEEPSEEK, DEEPINFRA, QWEN, CUSTOM)
IMAGE_PROVIDER=OPENAI                         # Which provider to use for image generation (OPENAI, DEEPINFRA)
SPEECH_PROVIDER=OPENAI                        # Which provider to use for text-to-speech conversion (OPENAI, ELEVENLABS)
TRANSCRIPTION_PROVIDER=OPENAI                 # Which provider to use for speech-to-text transcription (OPENAI, DEEPINFRA)

### PROVIDERS CONFIG (APIKEY, BASEURL)

# OPENAI CONFIGURATION
OPENAI_API_KEY=your_openai_api_key           # Your API key for OpenAI services
OPENAI_COMPLETION_MODEL=gpt-4o-mini          # Model to use for text completion/chat
OPENAI_IMAGE_MODEL=dall-e-3                  # Model to use for image generation
OPENAI_SPEECH_MODEL=tts-1                    # Model to use for text-to-speech
OPENAI_SPEECH_VOICE=nova                     # Voice to use for text-to-speech
OPENAI_TRANSCRIPTION_MODEL=whisper-1         # Model to use for speech-to-text
OPENAI_STORE=false                           # Whether to enable OpenAI server-side storage of conversations (default: false)

# CLAUDE CONFIGURATION
CLAUDE_API_KEY=your_claude_api_key           # Your API key for Anthropic's Claude
CLAUDE_CHAT_MODEL=claude-3-sonnet-20240229   # Model to use for Claude text completion
CLAUDE_MAX_TOKENS=2048                       # Maximum tokens for Claude completions (default: 2048)

# DEEPSEEK CONFIGURATION
DEEPSEEK_API_KEY=your_api_key                # Your API key for DeepSeek services
DEEPSEEK_COMPLETION_MODEL=deepseek-chat      # Model to use for DeepSeek text completion

# QWEN CONFIGURATION
QWEN_API_KEY=your_api_key                       # Your API key for Qwen services
QWEN_COMPLETION_MODEL=qwen2.5-vl-72b-instruct   # Model to use for Qwen text completion

# DEEPINFRA CONFIGURATION
# For proper operation, the chat model must support "Tools/Functions" and "Multimodal".
DEEPINFRA_API_KEY=your_api_key                                  # Your API key for DeepInfra services
DEEPINFRA_BASEURL=https://deepinfra.example.com/v1              # Base URL for DeepInfra API
DEEPINFRA_COMPLETION_MODEL=meta-llama/Llama-3.3-70B-Instruct    # Model for text completion
DEEPINFRA_IMAGE_CREATION_MODEL=stabilityai/sd3.5                # Model for image generation
DEEPINFRA_TRANSCRIPTION_MODEL=deepinfra-chat                    # Model for speech transcription

## ELEVENLABS CONFIG
ELEVENLABS_API_KEY=your_api_key                     # Your API key for Elevenlabs services
ELEVENLABS_VOICEID=EXAVITQu4vr4xnSDxMaL             # The VoiceID you want to use (leave empty to use the default)
ELEVENLABS_SPEECH_MODEL='eleven_multilingual_v2'    # The Speech Model to use

# CUSTOM AI CONFIGURATION (This might not always work. It is just for testing purposes.)
# For proper operation, the chat model must support "Tools/Functions" and "Multimodal".
CUSTOM_API_KEY=your_api_key                  # Your API key for custom AI provider
CUSTOM_BASEURL=https://ai.aiprovider.com/v1  # Base URL for custom AI provider API
CUSTOM_COMPLETION_MODEL=custom-model1.0      # Model to use for custom AI text completion

# BOT CONFIGURATION
PREFERRED_LANGUAGE=english                   # Default language for bot responses
MAX_CHARACTERS=2000                          # Maximum characters per response
BOT_NAME=Roboto                              # Name of the bot to be used in responses
MAX_IMAGES=3                                 # Maximum number of images to generate at once
MAX_MSGS_LIMIT=30                            # Maximum number of messages to keep in context
MAX_HOURS_LIMIT=24                           # Maximum time window for message context
NODE_CACHE_TIME=259200                       # Cache time in seconds for message data
TRANSCRIPTION_LANGUAGE=en                    # Default language for voice transcription
USE_CONTACT_NAMES=true                       # Determines whether the name of stored contacts will be used to identify each user
MEMORIES_ENABLED=true                        # Enable memory feature

# CACHE TTLs (override NODE_CACHE_TIME per category; 0 = use NODE_CACHE_TIME default)
# MESSAGE_CACHE_TTL=300                      # Per-chat message cache TTL in seconds
# MEDIA_CACHE_TTL=86400                      # Downloaded media cache TTL in seconds
# TRANSCRIPTION_CACHE_TTL=86400              # Transcribed voice cache TTL in seconds

# RATE LIMITING (optional; disabled by default)
# RATE_LIMIT_MAX=30                          # Max AI requests per window per chat/author. 0 = disabled
# RATE_LIMIT_WINDOW_SEC=60                   # Sliding window for rate limiting in seconds (default: 60)

# PUPPETEER / DOCKER
PUPPETEER_NO_SANDBOX=false                   # Set to true for Docker/CI environments that require --no-sandbox

# Additional prompt info to tailor the bot's personality (optional)
PROMPT_INFO="You should adopt a friendly and informal tone, often using emojis in responses"  # Custom instructions for bot personality

# FEATURE TOGGLES
IMAGE_CREATION_ENABLED=false                 # Whether image creation feature is enabled
VOICE_MESSAGES_ENABLED=false                 # Whether voice message processing is enabled

LOG_LEVEL=debug                              # Log level (debug, info, warn, error)
ADMIN_NUMBERS=14255550126                    # Comma-separated admin phone numbers (bypass rate limiting)

```

## API Key Resources

- [OpenAI API Keys](https://platform.openai.com/account/api-keys)
- [Anthropic API Keys](https://www.anthropic.com/account/api-keys)
- [Deepseek API Keys](https://platform.deepseek.com/)
- [Deepinfra API Keys](https://deepinfra.com/dash/api_keys)
- [QWEN API Keys](https://bailian.console.alibabacloud.com/?apiKey=1#/api-key-center)
- [ElevenLabs API Keys](https://elevenlabs.io/app/account)


## Docker / Puppeteer Note

> ⚠️ **Breaking change in v1.4.6**: The Puppeteer `--no-sandbox` flag is **no longer enabled by default**. If you run the bot in a Docker container or CI environment where Chromium requires `--no-sandbox`, you must explicitly set:
> ```
> PUPPETEER_NO_SANDBOX=true
> ```
> in your `.env` file. Without this, the WhatsApp client may fail to start in sandboxed environments.


---

## Known Issue with whatsapp-web.js ExecutionContext Error (Temporary Workaround)**

Some users have encountered an `ExecutionContext` error related to the `whatsapp-web.js` dependency version `^1.34.1`. The error looks like this:

```
Error: Evaluation failed: b
    at ExecutionContext._ExecutionContext_evaluate (...) 
    at async Client.sendMessage (...)
```

A temporary fix is to edit the file `node_modules/whatsapp-web.js/src/util/Store.js` and comment out the last line:

```js
// window.injectToFunction({ module: 'WAWebLid1X1MigrationGating', function: 'Lid1X1MigrationUtils.isLidMigrated' }, () => false);
```

This workaround will not affect normal bot functionality, except if you are using a Store feature.


---
## Updates in Version 1.1.0

With this update, the bot has gained the ability to understand and respond to voice messages. Users can now send voice messages to the bot, and it will transcribe and interpret them as part of the conversation. Additionally, if a user requests an audio response, the bot can generate and send a voice message in reply.

**Removed Feature:**
- The `-speak` command has been removed. It is no longer necessary due to the new functionality of handling voice messages directly.

This enhancement improves the bot's interactivity and makes conversations more natural and engaging.

## Updates in Version 1.1.1

- **Default Communication Language**: A new environment variable, `PREFERRED_LANGUAGE`, has been introduced. This allows users to specify a default language for the bot to use when communicating. If left empty, the bot will automatically detect and respond in the language of the chat it is replying to.
- **Configuration Management**: Users are now required to set configurations in the `.env` file instead of directly modifying the `config/index.ts` file. This change aims to simplify the setup process and improve manageability.

## Updates in Version 1.2.0

- Added support for QWEN, DEEPSEEK, and CUSTOM AI services. Now you can specify AI_LANGUAGE=QWEN, DEEPSEEK, or CUSTOM, and provide the relevant environment variables (completion models, API keys, and base URL for CUSTOM).
- Improved message-handling flow for faster response times.
- Image creation and voice messages remain available only if an OpenAI API key is present, regardless of which model is used for text chat. If OPENAI_API_KEY is missing, those features are disabled and only text chat functionality is available.

## Updates in Version 1.2.2

- **Customizable Bot Personality with `PROMPT_INFO`**: Introduced the ability to customize the bot's personality and behavior using the `PROMPT_INFO` environment variable. This allows you to provide specific instructions and contextual information that the bot can use to tailor its interactions. Whether it's adopting a casual tone, reminding group members of events, or just adding a fun twist to conversations, this feature enhances the personalization of the bot’s responses.

With this update, users can enhance the bot's interactivity by defining how it should behave in different contexts directly from the `.env` configuration file.

## Fixes in Version 1.2.4

- **Streaming Implementation**: Introduced streaming for API responses to mitigate frequent errors encountered with Deepseek and improve overall reliability.
- **Enhanced Deepseek Message Handling**: Implemented a specialized message handling approach for Deepseek due to its specific limitations and requirements.
- **Known Issues with Deepseek**: Please note that Deepseek services are currently experiencing intermittent availability issues. Users may encounter occasional errors or service interruptions when using Deepseek as the AI language model. We recommend using alternative AI services if you experience persistent issues with Deepseek.
- **WhatsAppWeb.js Update**: Updated whatsapp-web.js dependency to resolve issues with group chat recognition where the bot was responding without being explicitly mentioned. This update ensures the bot only responds in group chats when its name is mentioned, as intended.

## Updates in Version 1.3.0

- **Introduction of `-chatconfig` Command**: The `-chatconfig` command has been introduced to allow users to customize and manage the bot's behavior in specific chats or groups. This command provides flexibility in setting the bot's personality, name, and other configurations dynamically, enhancing user interaction and control.

- **Multiple Provider Selection**: Users can now choose different providers for various tasks. With this update, you have the flexibility to select different AI models for chat, image generation, and audio processing. This feature allows you to leverage the strengths of various providers, tailoring the bot's capabilities to better meet your specific needs. You can configure these preferences directly in the `.env` file, ensuring a seamless and personalized experience across different functionalities.


----------

## License

[MIT](https://choosealicense.com/licenses/mit/)

----------

Enjoy experimenting with your WhatsApp-Claude-GPT Bot!
