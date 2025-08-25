# WhatsApp-Claude-GPT

WhatsApp-Claude-GPT is a WhatsApp chatbot that supports multiple AI providers for chat, optional image generation/editing, and voice (speech-to-text and text-to-speech). It’s built for natural, contextual conversations and can now also handle reminders and personalized memory.

## Supported AI Providers

- OpenAI: Chat, Image Generation (+ Editing), Voice (TTS/STT), Web Search
- Anthropic Claude: Chat
- DeepSeek: Chat
- Deepinfra: Chat, Image Generation, Transcription
- Qwen: Chat
- ElevenLabs: Text-to-Speech

Note:
- Image editing and web search are OpenAI-only features.
- Voice features can be powered by OpenAI (TTS/STT) or ElevenLabs (TTS).

## What’s New in 1.4.0

- Reminders: Ask the bot to schedule reminders (one-time or recurring) in natural language. The bot will send a WhatsApp message at the scheduled time.
- Unified Memory: The bot can remember personal and group details to make conversations more personalized. This can be disabled to save tokens (see “Memory & Token Usage”).
- GPT‑5 Support: Works with OpenAI’s gpt-5-mini for chat.
- Per-chat configuration and quality-of-life improvements.

## Key Features

- Chat with context: Maintains recent context per chat or group (configurable).
- Reminders: Create, list, update, delete, deactivate, and reactivate reminders (including recurring reminders).
- Memory (optional): Remembers user/group info for more personalized replies. Can be turned off to reduce token usage.
- Images:
    - Generate images from text (OpenAI/Deepinfra).
    - Edit/transform images using references (OpenAI-only).
- Voice:
    - Understands voice messages via transcription.
    - Can reply with audio when requested.
- Group behavior: Only responds in groups when mentioned by name (e.g., “Hi Roboto…”).
- Per-chat configuration: Change bot name or personality per chat.
- Web Search (OpenAI-only): The bot may search the web to complete its answers.

## Requirements

- Node.js (tested with v22.14.0)
- A WhatsApp account to link with the bot (QR code login on first run)

## Quick Setup (OpenAI, simplest path)

1) Clone and install
- git clone https://github.com/noDiego/whatsapp-claude-gpt.git
- cd whatsapp-claude-gpt
- npm install

2) Create your .env from the example
- cp .env.example .env

3) Edit .env and set your OpenAI key and basic toggles:
- OPENAI_API_KEY=your_openai_api_key
- OPENAI_COMPLETION_MODEL=gpt-5-mini
- IMAGE_CREATION_ENABLED=true
- VOICE_MESSAGES_ENABLED=true
- MEMORIES_ENABLED=true

4) Start the bot
- npm run start
- Scan the QR code shown in your terminal with the WhatsApp app on your phone.

Tip: Consider a dedicated WhatsApp number for the bot so it doesn’t reply from your personal account.

## Basic Configuration (OpenAI)

Minimum working example in .env:
- CHAT_PROVIDER=OPENAI
- OPENAI_API_KEY=your_openai_api_key
- OPENAI_COMPLETION_MODEL=gpt-5-mini
- OPENAI_IMAGE_MODEL=gpt-image-1
- OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
- OPENAI_SPEECH_MODEL=gpt-4o-mini-tts
- OPENAI_SPEECH_VOICE=nova
- BOT_NAME=Roboto
- IMAGE_CREATION_ENABLED=true
- VOICE_MESSAGES_ENABLED=true
- MEMORIES_ENABLED=true

Optional:
- PREFERRED_LANGUAGE= (leave empty to auto-detect per chat)
- PROMPT_INFO="You are a friendly and informal assistant"

## Using the Bot

- Direct messages: Just talk to the bot normally.
- Group messages: Mention its name (default “Roboto”) to trigger a response.

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

### Images
- Generation: Ask naturally (“Create a logo with a minimalist fox in orange and black”).
- Editing/Transformations (OpenAI-only): Send an image and ask the bot to modify it (“Make the background transparent,” “Replace the sky with a sunset,” etc.). The bot will use the reference image(s) you sent most recently.

Example (OpenAI-only image editing):
[Place your edited image example here — OpenAI only]

### Voice
- Ask the bot to respond with audio:
    - “Please respond with an audio message.”
    - “Can you say this as an audio?”
- The bot also understands voice notes you send and will include them in context.

### Resetting the Conversation
- -reset
- Clears the recent context window for the chat.

### Per-Chat Configuration
- -chatconfig prompt Your custom personality here
- -chatconfig botname NewName
- -chatconfig show
- -chatconfig remove
- Only group admins can change config in group chats.

### Admin Controls
- -enable (admin only)
- -disable (admin only)

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

## Simple Examples (OpenAI)

In .env:
- OPENAI_API_KEY=your_openai_api_key
- OPENAI_COMPLETION_MODEL=gpt-5-mini
- OPENAI_IMAGE_MODEL=gpt-image-1
- OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
- OPENAI_SPEECH_MODEL=gpt-4o-mini-tts
- OPENAI_SPEECH_VOICE=nova
- BOT_NAME=Roboto
- IMAGE_CREATION_ENABLED=true
- VOICE_MESSAGES_ENABLED=true
- MEMORIES_ENABLED=true

Start:
- npm run start
- Scan the QR

Use:
- “Hey Roboto, remind me in 30 minutes to call mom.”
- “Make a 3D icon of a blue rocket.”
- “Please respond with an audio message.”
- “-memory show”
- “-reset”

## API Key Resources

- OpenAI: https://platform.openai.com/account/api-keys
- Anthropic: https://www.anthropic.com/account/api-keys
- DeepSeek: https://platform.deepseek.com/
- Deepinfra: https://deepinfra.com/dash/api_keys
- Qwen: https://bailian.console.alibabacloud.com/?apiKey=1#/api-key-center
- ElevenLabs: https://elevenlabs.io/app/account

## Notes

- The first WhatsApp account that scans the QR will send all bot replies. Prefer a separate number for the bot.
- A local SQLite database (roboto.sqlite) is created automatically for chat configs, reminders, and memory.

## License

MIT
