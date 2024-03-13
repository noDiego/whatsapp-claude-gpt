# WhatsApp-Claude-GPT

WhatsApp-Claude-GPT is a chatbot application designed for seamless interaction on WhatsApp. It offers two options for creating a WhatsApp bot: using OpenAI (with ChatGPT) or Anthropic (with Claude). The application leverages state-of-the-art language models to generate textual responses and engage in conversations with users.

Please note that image and audio creation functionalities are exclusive to OpenAI. To use these features, you must provide an OpenAI API Key, even if you choose to use Anthropic's Claude for text generation.

## Key Features

- **Automatic Responses**: Generates coherent and contextual responses to received messages.
- **Image Creation** (OpenAI only): Can create images from text descriptions using the `-image` command.
- **Speech Synthesis** (OpenAI only): Capable of converting text into audio using the `-speak` command. If no text is specified after the command, it will use the last message sent by the bot as the input text.
- **Group Interaction**: When added to a group, the bot requires that its name be mentioned to activate and respond. Example: "Hi *Roboto*, how are you?"

## Setting Up Your OpenAI API Key

Before you begin using WhatsApp-Claude-GPT, you need to provide your API keys to authenticate requests made to the OpenAI and Anthropic services. You can provide your API keys in two ways:

1. **Environment Variables**: This is the recommended way to set your API keys. In the root of your project, you will find a file named `.env`. Open this file and add the following lines:
   ```
   OPENAI_API_KEY=your_openai_key_here
   CLAUDE_API_KEY=your_anthropic_key_here
   ```
   Replace `your_openai_key_here` with your actual OpenAI API key and `your_anthropic_key_here` with your actual Anthropic API key.

2. **Directly in Configuration**: As an alternative, you can directly set your API keys in the `src/config/index.ts` file:
    - For OpenAI, locate the `openAI` configuration object and set the `apiKey` property:
      ```typescript
      const openAI = {
        apiKey: "your_openai_key_here", // Replace this with your actual OpenAI API key
        // Remaining properties
      };
      ```
    - For Anthropic, locate the `anthropic` configuration object and set the `apiKey` property:
      ```typescript
      const anthropic = {
        apiKey: "your_anthropic_key_here", // Replace this with your actual Anthropic API key
        // Remaining properties
      };
      ```

    - Furthermore, ensure the `aiLanguage` within `botConfig` in `src/config/index.ts` is appropriately selected to use either "OPENAI" or "ANTHROPIC" based on your preference. This setting can also be configured through the `.env` file by adding the line:

      ```
      AI_LANGUAGE=OPENAI
      ```

      or

      ```
      AI_LANGUAGE=ANTHROPIC
      ```
      depending on which service you intend to use.

**You can find your OpenAI API key in your [OpenAI Account Settings](https://platform.openai.com/account/api-keys).**

**You can find your Anthropic API key in your [Anthropic Account Settings](https://www.anthropic.com/account/api-keys).**




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
3. Set up your OpenAI and Anthropic API keys by following the [Setting Up Your OpenAI and Anthropic API Keys](#setting-up-your-openai-and-anthropic-api-keys) section and ensuring the `aiLanguage` is correctly chosen.

Once the installation and configuration are complete, you are all set to start and enjoy the functionalities of WhatsApp-Claude-GPT.

## How to Start

To start the bot, run the following command in the terminal:
```
npm run start
```
Upon startup, the bot will display a QR code in the terminal. Scan this QR code using the WhatsApp application on your mobile phone to link the bot to your WhatsApp account.

## Configuration Options (`src/config/index.ts`)

In the `src/config/index.ts` file, you can adjust several settings to customize the bot's behavior. Here are some of the key parameters you can modify:

- **aiLanguage**: Specifies the AI language model to be used. It can be set to either "ANTHROPIC" or "OPENAI".
- **botName**: The name the bot will respond to in groups.
- **maxCharacters**: The maximum number of characters the chat model will output in a single completion.
- **maxImages**: The maximum number of images the bot can process from the recent messages.
- **maxMsgsLimit**: The maximum number of messages the bot will remember and use for generating responses.
- **maxHoursLimit**: The time frame in hours for the bot to consider recent messages.
- **prompt**: The initial system prompt used to guide the conversation flow. It's automatically configured but can be manually adjusted if needed.
- **imageCreationEnabled** and **audioCreationEnabled**: Flags to enable or disable image creation and speech synthesis functionalities.

### OpenAI Configuration

- **apiKey**: Your OpenAI API key for authentication against the OpenAI services.
- **chatCompletionModel**: The model used by OpenAI for chat completions. It can be changed to use different models. It is important to use a "vision" version to be able to identify images.
- **imageCreationModel**: The model used by OpenAI for generating images based on text descriptions.
- **speechModel**: The model used by OpenAI for generating speech from text.
- **speechVoice**: Specifies the voice model to be used in speech synthesis.

### Anthropic Configuration

- **apiKey**: Your Anthropic API key for authentication against the Anthropic services.
- **chatModel**: The model used by Anthropic for chat interactions.
- **maxCharacters**: The maximum number of characters the Anthropic chat model will output in a single completion.

Other configurations related to OpenAI models (e.g., `chatCompletionModel`, `imageCreationModel`, `speechModel`) can also be adjusted here to use different versions or models provided by OpenAI.

## Using Commands

### Creating Images with `-image`

To generate an image based on text, use the `-image` command followed by a description of the item you want to create. For example:
```
-image a nighttime landscape with stars
```

Example:

<img src="https://i.imgur.com/mAlBnl9.jpg" width="650">

### Generating Audio with `-speak`

The `-speak` command allows you to convert text into audio. For example:
```
-speak This is a test message.
```
Or simply use `-speak` to generate audio from the last message sent by the bot.

Example:

<img src="https://i.imgur.com/UEqnvBM.jpg" width="650">

### Resetting Chat Context with `-reset`

The `-reset` command is designed to clear the chatbot's current conversation context. When you issue this command, it effectively "forgets" the messages that have been processed so far, starting fresh as if the conversation with the user had just begun. This can be particularly useful in scenarios where the conversation has diverged significantly from its original intent or when you wish to start a new topic without the chatbot attempting to maintain continuity with previous messages.

To use the `-reset` command, simply type and send:
```
-reset
```

This command has no additional parameters. Once sent, any subsequent messages will be treated as the beginning of a new conversation, without consideration for what was discussed previously. This can enhance the relevancy and accuracy of the chatbot's responses moving forward.

## Final Notes

Remember that the functionalities like image creation and speech synthesis depend on your access to the OpenAI API and the quotas associated with your account. Ensure your environment is correctly set up and that you have the required quotas to use these features.

Enjoy interacting with your WhatsApp-Claude-GPT!

## License

[MIT](https://choosealicense.com/licenses/mit/)

