# WhatsApp-GPT Bot

WhatsApp-GPT Bot is a chatbot application designed for seamless interaction on WhatsApp. It leverages the state-of-the-art "gpt-4-vision-preview" model from OpenAI, which uniquely enables it to not only generate textual responses but also understand and interpret images sent by users. Whether you're looking to have a conversation, create images from text descriptions, or convert messages into spoken words, WhatsApp-GPT Bot offers a dynamic and interactive chatting experience. Through advanced AI technology, including GPT for text generation, DALL-E for image creation, and speech synthesis models, this bot transcends traditional chat functionalities, bringing a versatile and enriching conversational engagement to WhatsApp.

## Key Features

- **Automatic Responses**: Generates coherent and contextual responses to received messages.
- **Image Creation**: Can create images from text descriptions using the `-image` command.
- **Speech Synthesis**: Capable of converting text into audio using the `-speak` command. If no text is specified after the command, it will use the last message sent by the bot as the input text.

- **Group Interaction**: When added to a group, the bot requires that its name be mentioned to activate and respond. Example: "Hi *Roboto*, how are you?"

## Setting Up Your OpenAI API Key

Before you begin using WhatsApp-GPT, you need to provide your OpenAI API key to authenticate requests made to the OpenAI services. You can provide your OpenAI API key in two ways:

1. **Environment Variable**: This is the recommended way to set your OpenAI API key. In the root of your project, you will find a file named `.env`. Open this file and add the following line:
   ```
   OPENAI_API_KEY=your_key_here
   ```
   Replace `your_key_here` with your actual OpenAI API key.

2. **Directly in Configuration**: As an alternative, you can directly set your API key in the `src/config/index.ts` file under the `openAI` configuration object:
   ```typescript
   const openAI = {
     apiKey: "your_key_here", // Replace this with your actual OpenAI API key
     // Remaining properties
   };
   ```

**You can find your Secret API key in [User Settings](https://platform.openai.com/account/api-keys)** 

## Requirements

Before initializing the bot, make sure you have [Node.js](https://nodejs.org/en/download/) installed. 
(It was tested with Node v18.15.0)

## Installation

1. Clone the repository and navigate to the project directory:
   ```
   git clone <repository_url>
   cd whatsapp-gpt
   ```
2. Install the dependencies:
   ```
   npm install
   ```

## How to Start

To start the bot, run the following command in the terminal:
```
npm run start
```
Upon startup, the bot will display a QR code in the terminal. Scan this QR code using the WhatsApp application on your mobile phone to link the bot to your WhatsApp account.

## Configuration Options (`src/config/index.ts`)

In the `src/config/index.ts` file, you can adjust several settings to customize the bot's behavior. Here are some of the key parameters you can modify:

- **botName**: The name the bot will respond to in groups.
- **maxImages**: The maximum number of images the bot can process from the recent messages.
- **maxMsgsLimit**: The maximum number of messages the bot will remember and use for generating responses.
- **maxHoursLimit**: The time frame in hours for the bot to consider recent messages.
- **prompt**: The initial system prompt used to guide the conversation flow. It's automatically configured but can be manually adjusted if needed.
- **imageCreationEnabled** and **audioCreationEnabled**: Flags to enable or disable image creation and speech synthesis functionalities.

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

Enjoy interacting with your WhatsApp-GPT Bot!

## License

[MIT](https://choosealicense.com/licenses/mit/)

