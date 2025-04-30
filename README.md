# WhatsApp-Claude-GPT

**Version:** 1.3.2 • **License:** MIT • by Diego Beltran <diego.beltran88@gmail.com>

---

## 📖 Overview

**WhatsApp-Claude-GPT** is an advanced AI-powered chatbot for WhatsApp. It leverages OpenAI’s chat models (e.g. GPT-4), image-generation, and voice-message capabilities (speech-to-text and text-to-speech) to provide natural, context-aware conversations directly in your WhatsApp chats and groups.

**Key features**:
- Natural language conversations with GPT-4 (or your preferred OpenAI model)
- Image understanding and guided image-generation commands
- Voice-message transcription (STT) and synthesis (TTS)
- Per-chat (and per-group) custom prompts and bot names
- Conversation history management, rate limits, and cache
- Function calling for TTS automation
- Configurable character, message and age limits

---

## 📋 Table of Contents

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Running the Bot](#running-the-bot)
6. [In-Chat Commands](#in-chat-commands)
7. [Project Structure](#project-structure)
8. [Contributing](#contributing)
9. [License](#license)

---

## 🚀 Features

- **Chat with AI**: GPT-4 (or specified model) handles text conversations.
- **Image Generation**: Guide users to generate images via `-image <description>`.
- **Speech-to-Text**: Transcribe incoming voice notes (OpenAI Whisper or custom STT).
- **Text-to-Speech**: Send voice replies (OpenAI TTS or ElevenLabs).
- **Per-Chat Customization**: Change bot prompt and name in each chat or group with `-chatconfig`.
- **Context Management**: Limits on message count, character length, image count and message age.
- **Cache**: Avoids re-transcribing or re-speaking the same content.
- **Secure & Configurable**: All keys and models stored in environment variables.

---

## ⚙️ Prerequisites

- **Node.js** >= v18.x
- **npm** or **yarn**
- A WhatsApp account (the bot runs via `whatsapp-web.js` and a browser-session QR code)
- OpenAI API key
- (Optional) ElevenLabs API key for TTS

---

## 🛠️ Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/noDiego/whatsapp-claude-gpt.git
   cd whatsapp-claude-gpt
   ```

2. Install dependencies:

   ```bash
   npm install
   # or
   yarn install
   ```

3. Create a `.env` file at the project root (copy from `.env.example` if provided).

---

## 🔧 Configuration

Populate your `.env` with the following variables:

```dotenv
# ─── OpenAI & Model Configuration ────────────────────────
OPENAI_API_KEY=your_openai_api_key
CHAT_COMPLETION_MODEL=gpt-4.1 # or your preferred model
IMAGE_CREATION_MODEL=gpt-image-1 # or DALL·E model

# ─── ElevenLabs (TTS) ───────────────────────────────────
ELEVENLABS_API_KEY=your_elevenlabs_key
VOICE_MESSAGES_ENABLED=true # enable voice reply
SPEECH_PROVIDER=ELEVENLABS # or OPENAI
SPEECH_MODEL=gpt-4o-mini-tts # for OpenAI TTS
SPEECH_VOICE=nova # default TTS voice

# ─── Whisper (STT) ──────────────────────────────────────
TRANSCRIPTION_MODEL=gpt-4o-transcribe
TRANSCRIPTION_LANGUAGE=en

# ─── Bot Defaults & Limits ──────────────────────────────
BOT_NAME=Roboto # default bot name
PREFERRED_LANGUAGE= # e.g. "es" or leave blank to auto-detect
MAX_CHARACTERS=2000 # per AI response
MAX_IMAGES=5 # images processed per request
MAX_MSGS_LIMIT=30 # recent messages to include
MAX_HOURS_LIMIT=24 # hours old messages to include
NODE_CACHE_TIME=259200 # cache duration in seconds (3 days)
PROMPT_INFO= # optional global personality prompt

# ─── Feature Toggles ────────────────────────────────────
IMAGE_CREATION_ENABLED=true # “-image” commands allowed
```

After editing, save `.env`.

---

## ▶️ Running the Bot

### Development / Debug mode

```bash
npm run debug
# or
yarn debug
```

- Scans a QR code in your terminal. Scan it with your WhatsApp mobile app to authenticate.
- The bot will log configuration summary and start listening.

### Production mode

```bash
npm run start
# (this runs `build` then `node build/index.js`)
```

---

## 💬 In-Chat Commands

### General behavior
- In **private chats** the bot will reply to any message.
- In **group chats** it only responds when:
    - You mention the bot’s name (configured or default).
    - You quote one of its messages.
- Non-text messages (stickers, images, voice) are processed up to configured limits.

### Commands (prefix with `-`)

| Command                   | Description                                                               |
|---------------------------|---------------------------------------------------------------------------|
| **-reset**                | Clear the conversation context (forget previous history).                  |
| **-chatconfig prompt …**  | Set a custom personality prompt for _this_ chat or group.                 |
| **-chatconfig botname …** | Change the bot’s display name for _this_ chat or group.                   |
| **-chatconfig show**      | Show current custom settings (prompt & bot name).                         |
| **-chatconfig remove**    | Remove custom settings (revert to defaults).                              |
| **-image <description>**  | Guide user to generate an image with AI (if enabled).                     |

**Examples**:

```text
-user: -chatconfig prompt You are a friendly movie buff.
-bot: ✅ Updated prompt for this chat. The bot now: You are a friendly movie buff.

-user: -chatconfig botname CineBot
-bot: ✅ Bot name for this chat has been set to: CineBot.

-user: -chatconfig show
-bot: Current personality: You are a friendly movie buff.
 Bot name: CineBot

-user: -reset
-bot: (reacts 👍 and forgets previous context)
```

---

## 📂 Project Structure

```
whatsapp-claude-gpt/
├── src/
│   ├── config/                  # Environment & chat-config managers
│   │   ├── index.ts             # Loads .env & builds system prompts
│   │   └── chat-configurations.ts # Per-chat JSON config persistence
│   ├── interfaces/              # TypeScript interfaces
│   ├── logger.ts                # winston logger setup
│   ├── roboto.ts                # Core message handling & AI orchestration
│   ├── services/                # API integrations (OpenAI & ElevenLabs)
│   ├── utils/                   # Helpers: parsing, streaming, caching
│   └── index.ts                 # Entry point: WhatsApp client init
├── chat-configurations.json     # Generated on first run
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🤝 Contributing

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/YourFeature`).
3. Commit your changes (`git commit -am 'Add some feature'`).
4. Push to the branch (`git push origin feature/YourFeature`).
5. Open a Pull Request.

Please follow conventional commits and maintain code style.

---

## ⚖️ License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.

Enjoy your AI-powered WhatsApp companion! 🚀