# WhatsApp-Claude-GPT

WhatsApp-Claude-GPT is a chatbot application designed for seamless interaction on WhatsApp. It integrates flexible AI language models for text chat and, optionally, OpenAI’s image-creation and voice features. Currently, it fully supports:

- OpenAI (ChatGPT and related image/audio models)
- Anthropic (Claude)
- DeepSeek
- QWEN
- Any custom AI service ("CUSTOM" mode)

When using an AI language model other than OpenAI for chat (e.g., CLAUDE, QWEN, DEEPSEEK, CUSTOM), you can still enable image creation and voice interaction if—and only if—you’ve set your OpenAI API Key. Without an OpenAI key, you will only be able to use text chat capabilities.

## Key Features

- **Automatic Responses**: Generates coherent and contextual responses to received messages.
- **Image Creation** (OpenAI only): Can create images from text descriptions using the `-image` command.
- **Voice Interaction** (OpenAI only): Capable of both understanding voice messages and responding with its own voice messages upon request.
- **Group Interaction**: When added to a group, the bot requires that its name be mentioned to activate and respond. Example: "Hi Roboto, how are you?"
- **Context management**: The bot keeps track of a customizable number of recent messages for context, with optional reset functionality.
- **Custom AI Integration**: Supports any AI service that implements OpenAI-compatible API endpoints. Simply provide the base URL and API key in the configuration to integrate your custom AI service.

## Setting Up Your API Keys

### Using the .env File

You must provide the correct API keys in your .env file for whichever model(s) you intend to use. Below is an example with all possible variables:

```
## OPENAI CONFIG
OPENAI_API_KEY=your_openai_api_key
CHAT_COMPLETION_MODEL=gpt-4o-mini   # Model for chat completions
IMAGE_CREATION_MODEL=dall-e-3       # Model for image generation
SPEECH_MODEL=tts-1                  # Model for speech synthesis
SPEECH_VOICE=nova                   # Voice model for speech synthesis
TRANSCRIPTION_LANGUAGE=en           # The language used for transcribing audio, in ISO-639-1 format (e.g., "en" for English).

## CLAUDE CONFIG
CLAUDE_API_KEY=your_claude_api_key
CLAUDE_CHAT_MODEL=claude-3-sonnet-20240229  # Model for Claude chat interactions

## DEEPSEEK CONFIG
DEEPSEEK_API_KEY=your_api_key
DEEPSEEK_COMPLETION_MODEL=deepseek-chat

## QWEN CONFIG
QWEN_API_KEY=your_api_key
QWEN_COMPLETION_MODEL=qwen2.5-vl-72b-instruct

## CUSTOM AI CONFIG (Must be OpenAI API-compatible)
CUSTOM_BASEURL=https://ai.aiprovider.com/v1   # The base URL for your OpenAI API-compatible service
CUSTOM_API_KEY=your_api_key                   # Your API key for the custom service
CUSTOM_COMPLETION_MODEL=custom-model1.0       # The model identifier for your custom service

## BOT CONFIG
AI_LANGUAGE=OPENAI                    # Specifies the AI language model to be used. It can be set to either "ANTHROPIC" or "OPENAI".
PREFERRED_LANGUAGE=                   # The default language for the bot. If not specified, the bot will use the language of the chat it is responding to.
MAX_CHARACTERS=2000                   # The maximum number of characters the chat model will output in a single completion
BOT_NAME=Roboto                       # The name the bot will respond to in groups.
MAX_IMAGES=3                          # The maximum number of images the bot can process from the recent messages
MAX_MSGS_LIMIT=30                     # The maximum number of messages the bot will remember and use for generating responses
MAX_HOURS_LIMIT=24                    # The time frame in hours for the bot to consider recent messages
NODE_CACHE_TIME=259200                # Cache time for stored data in seconds (3 days)

IMAGE_CREATION_ENABLED=false           # Enable image creation (OpenAI Only)
VOICE_MESSAGES_ENABLED=false           # Enable voice responses (OpenAI Only)
```

If you choose OpenAI for text chat (AI_LANGUAGE=OPENAI), you must define OPENAI_API_KEY.  
If you choose CLAUDE, QWEN, DEEPSEEK, or CUSTOM, you must define the API key and any necessary base URL or model IDs for that service.  
Image creation and audio handling only become active if OPENAI_API_KEY is present and you enable them in your .env.

- **You can find your OpenAI API key in your [OpenAI Account Settings](https://platform.openai.com/account/api-keys).**
- **You can find your Anthropic API key in your [Anthropic Account Settings](https://www.anthropic.com/account/api-keys).**
- **You can find your Deepseek API key in your [Deepseek Account Settings](https://platform.deepseek.com/).**
- **You can find your QWEN API key in your [Alibabacloud Account Settings](https://bailian.console.alibabacloud.com/?apiKey=1#/api-key-center).**

## Requirements

Before initializing the bot, make sure you have [Node.js](https://nodejs.org/en/download/) installed.
(It was tested with Node v18.15.0)

## Installation

1. Clone the repository and navigate to the project directory:
   ```
   git clone https://github.com/noDiego/whatsapp-claude-gpt.git
   cd whatsapp-claude-gpt
   ```
2. Install the project dependencies:
   ```
   npm install
   ```
3. Set up your API keys in the `.env` file as described above.

Once the installation and configuration are complete, you are all set to start and enjoy the functionalities of WhatsApp-Claude-GPT.

## How to Start

To start the bot, run the following command in the terminal:
```
npm run start
```
Upon startup, the bot will display a QR code in the terminal. Scan this QR code using the WhatsApp application on your mobile phone to link the bot to your WhatsApp account.

#### Note About WhatsApp Number:
The phone number associated with the WhatsApp account that scans the QR code will be the one sending all automated responses. If you want to maintain a separate bot account, it is recommended to:

- Use a different phone number than your personal one
- Install WhatsApp using that different number
- Use that WhatsApp instance to scan the QR code

This way, your personal WhatsApp account remains separate from the bot's activities, and you can interact with the bot just like any other contact.

## Using Commands

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


## Using Custom AI Services
When using the CUSTOM AI_LANGUAGE option, your custom AI service must be compatible with OpenAI's API format and endpoints. This means the service should accept requests and provide responses in the same format as OpenAI's API. You'll need to provide:
- A base URL (CUSTOM_BASEURL) pointing to your service's API endpoint
- A valid API key (CUSTOM_API_KEY) for authentication
- The model identifier (CUSTOM_COMPLETION_MODEL) supported by your service

The custom service should implement the chat completions endpoint in a way that's compatible with OpenAI's API structure.

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

## Final Notes

• Make sure your API quotas and keys are valid for the AI language you choose.  
• Image and audio features use OpenAI services. Include OPENAI_API_KEY and enable these features in your .env if desired, even when employing QWEN, DEEPSEEK, or CUSTOM for text.  
• Enjoy experimenting with your WhatsApp-Claude-GPT Bot!

## License

[MIT](https://choosealicense.com/licenses/mit/)

