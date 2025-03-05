# WhatsApp-Claude-GPT

WhatsApp-Claude-GPT is a chatbot application designed for seamless interaction on WhatsApp. It integrates flexible AI language models for text chat and, optionally, OpenAI’s image-creation and voice features. Currently, it fully supports:

## Supported AI Providers

- **OpenAI**: Chat, Image Generation, Voice (TTS/STT)
- **Anthropic Claude**: Chat
- **DeepSeek**: Chat
- **Deepinfra**: Chat, Image Generation, Transcription
- **QWEN**: Chat
- **ElevenLabs**: Text-to-Speech

## Key Features

- **Automatic Responses**: Generates coherent and contextual responses to messages
- **Image Creation**: Creates images from text descriptions using the `-image` command
- **Voice Interaction**: Understands voice messages and can respond with voice messages
- **Group Interaction**: Responds in groups when its name is mentioned (e.g., "Hi Roboto, how are you?")
- **Context Management**: Tracks recent messages for context with customizable limits
- **Per-Chat Configuration**: Customize the bot's personality and name per chat or group
- **Multi-Provider Support**: Use different AI providers for different features

## Requirements

Before initializing the bot, make sure you have [Node.js](https://nodejs.org/en/download/) installed.
(It was tested with Node v18.15.0)

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

4. Edit the `.env` file with your API keys and preferences. (See [API Key Resources](#api-key-resources) or [Configuration with .env File](#configuration-with-env-file) )


5. Start the bot:
   ```
   npm run start
   ```

6. Upon startup, the bot will display a QR code in the terminal. Scan this QR code using the WhatsApp application on your mobile phone to link the bot to your WhatsApp account.

> **Note**: The WhatsApp account that scans the QR code will be sending all bot responses. Consider using a separate phone number for the bot.
This way, your personal WhatsApp account remains separate from the bot's activities, and you can interact with the bot just like any other contact.
>

## Basic Configuration

At minimum, you need an API key for one of the supported AI providers. For basic usage with OpenAI:

```
OPENAI_API_KEY=your_api_key
BOT_NAME=Roboto
IMAGE_CREATION_ENABLED=true
VOICE_MESSAGES_ENABLED=true
```

## Using the Bot

### Chatting

- **Direct chat**: Simply send a message to the bot
- **Group chat**: Mention the bot's name (e.g., "Hey Roboto, what's the weather today?")

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

### Creating Images with `-image`

To generate an image based on text, use the `-image` command followed by a description of the item you want to create. For example:
```
-image a nighttime landscape with stars
```

Example:

<img src="https://i.imgur.com/mAlBnl9.jpg" width="650">

### Requesting Audio Responses
The bot can now respond with audio messages as well as understand voice messages from users. To request an audio response from the bot, you can include a specific request in your message. For example:
```bash
Please respond with an audio message.
```
Or:
```bash
Can you say this as an audio?
```

Additionally, the bot is capable of processing and understanding voice messages sent by users. It will transcribe and consider the content of these voice messages when generating its responses, ensuring a seamless voice interaction.

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

## FEATURES
IMAGE_CREATION_ENABLED=true           # Enable image creation
VOICE_MESSAGES_ENABLED=true           # Enable voice responses

# You can use this to customize the default bot's personality and information (Or it can be customized using -chatconfig)
PROMPT_INFO="You should use a casual tone with plenty of emojis."
```

This basic configuration is all you need to get started. The bot will use OpenAI for all services.

## Advanced Configuration Options

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

# CLAUDE CONFIGURATION
CLAUDE_API_KEY=your_claude_api_key           # Your API key for Anthropic's Claude
CLAUDE_CHAT_MODEL=claude-3-sonnet-20240229   # Model to use for Claude text completion

# DEEPSEEK CONFIGURATION
DEEPSEEK_API_KEY=your_api_key                # Your API key for DeepSeek services
DEEPSEEK_COMPLETION_MODEL=deepseek-chat      # Model to use for DeepSeek text completion

# QWEN CONFIGURATION
QWEN_API_KEY=your_api_key                       # Your API key for Qwen services
QWEN_COMPLETION_MODEL=qwen2.5-vl-72b-instruct   # Model to use for Qwen text completion

# DEEPINFRA CONFIGURATION
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

# Additional prompt info to tailor the bot's personality (optional)
PROMPT_INFO="You should adopt a friendly and informal tone, often using emojis in responses"  # Custom instructions for bot personality

# FEATURE TOGGLES
IMAGE_CREATION_ENABLED=false                 # Whether image creation feature is enabled
VOICE_MESSAGES_ENABLED=false                 # Whether voice message processing is enabled

```

## API Key Resources

- [OpenAI API Keys](https://platform.openai.com/account/api-keys)
- [Anthropic API Keys](https://www.anthropic.com/account/api-keys)
- [Deepseek API Keys](https://platform.deepseek.com/)
- [Deepinfra API Keys](https://deepinfra.com/dash/api_keys)
- [QWEN API Keys](https://bailian.console.alibabacloud.com/?apiKey=1#/api-key-center)
- [ElevenLabs API Keys](https://elevenlabs.io/app/account)

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
• Enjoy experimenting with your WhatsApp-Claude-GPT Bot!

## License

[MIT](https://choosealicense.com/licenses/mit/)

