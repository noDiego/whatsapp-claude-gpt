import { Chat, Message, MessageMedia, MessageTypes } from "whatsapp-web.js";
import { AIConfig, CONFIG } from "./config";
import { bufferToStream, getContactName, getUnsupportedMessage } from "./utils";
import logger from "./logger";
import { AIContent, AiMessage, AIProvider, AIRole } from "./interfaces/ai-interfaces";
import { MessageParam } from "@anthropic-ai/sdk/src/resources/messages";
import { ResponseInput } from "openai/resources/responses/responses";
import { ChatCompletionMessageParam } from "openai/resources";
import NodeCache from "node-cache";
import { MessageParam as AnthropicMessageParam } from "@anthropic-ai/sdk/resources";
import { RobotoInstance } from "./index";

export class MessageHandler {

    private _cache: NodeCache;

    constructor() {
        this._cache = new NodeCache();
    }

    /**
     * Processes an incoming message and generates an AI response based on chat context.
     *
     * This function is responsible for:
     * 1. Collecting recent chat messages to build conversation context
     * 2. Processing multiple content types (text, images, audio)
     * 3. Handling transcription of voice messages
     * 4. Applying chat-specific configurations (custom prompts, bot names)
     * 5. Selecting the appropriate AI provider and formatting messages accordingly
     *
     * The function limits context by time (messages older than maxHoursLimit are ignored)
     * and resets context if a "-reset" command is found in the chat history.
     *
     * @param chatData - The Chat object representing the conversation
     * @returns A promise that resolves with the AI-generated response or null if no response needed
     */
    public async createMessageArray(chatData: Chat, botName: string): Promise<AiMessage[]> {

        const actualDate = new Date();
        const analyzeImages = !AIConfig.ChatConfig.analyzeImageDisabled;

        // Initialize an array of messages
        const messageList: AiMessage[] = [];

        // Placeholder for promises for transcriptions - Image Counting
        let transcriptionPromises: { index: number, promise: Promise<string> }[] = [];
        let imageCount: number = 0;

        // Retrieve the last 'limit' number of messages to send them in order
        const fetchedMessages = await chatData.fetchMessages({limit: CONFIG.botConfig.maxMsgsLimit});
        // Check for "-reset" command in chat history to potentially restart context
        const resetIndex = fetchedMessages.map(msg => msg.body).lastIndexOf("-reset");
        const messagesToProcess = resetIndex >= 0 ? fetchedMessages.slice(resetIndex + 1) : fetchedMessages;

        for (const msg of messagesToProcess.reverse()) {
            try {
                // Validate if the message was written less than 24 (or maxHoursLimit) hours ago; if older, it's not considered
                const msgDate = new Date(msg.timestamp * 1000);
                if ((actualDate.getTime() - msgDate.getTime()) / (1000 * 60 * 60) > CONFIG.botConfig.maxHoursLimit) break;

                // Checks if a message already exists in the cache
                const cachedMessage = this.getCachedMessage(msg);

                // Check if the message includes media or if it is of another type
                const isImage = msg.type === MessageTypes.IMAGE || msg.type === MessageTypes.STICKER;
                const isAudio = msg.type === MessageTypes.VOICE || msg.type === MessageTypes.AUDIO;
                const isOther = !isImage && !isAudio && msg.type != 'chat';

                // Limit the number of processed images to only the last few and ignore audio if cached
                const media = (isImage && imageCount < CONFIG.botConfig.maxImages && analyzeImages) || (isAudio && !cachedMessage) ?
                    await msg.downloadMedia() : null;

                if (media && isImage) imageCount++;

                const role = (!msg.fromMe || isImage) ? AIRole.USER : AIRole.ASSISTANT;
                const name = msg.fromMe ? botName : (await getContactName(msg));

                // Assemble the content as a mix of text and any included media
                const content: Array<AIContent> = [];
                if (isOther || (isAudio && !AIConfig.TranscriptionConfig.enabled))
                    content.push({type: 'text', value: getUnsupportedMessage(msg.type, msg.body)});
                else if (isAudio && media && !cachedMessage) {
                    transcriptionPromises.push({index: messageList.length, promise: this.transcribeVoice(media, msg)});
                    content.push({type: 'audio', value: '<Transcribing voice message...>'});
                }
                if (isAudio && cachedMessage) content.push({type: 'audio', value: cachedMessage});
                if (isImage && media) content.push({type: 'image', value: media.data, media_type: media.mimetype});
                if (isImage && !media) content.push({type: 'text', value: '<Unprocessed image>'});
                if (msg.body && !isOther) content.push({type: 'text', value: msg.body});

                messageList.push({role: role, name: name, content: content});
            } catch (e: any) {
                logger.error(`Error reading message - msg.type:${msg.type}; msg.body:${msg.body}. Error:${e.message}`);
            }
        }

        // If no new messages are present, return without action
        if (messageList.length == 0) return;

        // Wait for all transcriptions to complete
        const transcriptions = await Promise.all(transcriptionPromises.map(t => t.promise));
        transcriptionPromises.forEach((transcriptionPromise, idx) => {
            const transcription = transcriptions[idx];
            const messageIdx = transcriptionPromise.index;
            messageList[messageIdx].content = messageList[messageIdx].content.map(c =>
                c.type === 'audio' && c.value === '<Transcribing voice message...>' ? {type: 'audio', value: transcription} : c
            );
        });

        return messageList.reverse();
    }



    /**
     * Converts AI message structures between different language model formats.
     *
     * This function transforms message arrays into formats compatible with various AI providers:
     * - OpenAI: Structured with system, user and assistant roles
     * - Claude: Requires alternating user/assistant roles with specific content formats
     * - Qwen: Similar to OpenAI but with provider-specific adaptations
     * - DeepSeek: Uses JSON formatting with text blocks
     * - DeepInfra/Custom: Uses simplified message formatting
     *
     * The function handles text, audio transcriptions, and images appropriately for each provider.
     *
     * @param messageList - Array of AI messages to convert
     * @param lang - The target AI provider format
     * @param systemPrompt - Optional system prompt to include
     * @returns Formatted message array compatible with the specified AI provider
     */
    public convertIaMessagesLang(messageList: AiMessage[], lang: AIProvider, systemPrompt?: string): MessageParam[] | ChatCompletionMessageParam[] | ResponseInput {
        switch (lang) {
            case AIProvider.CLAUDE:

                const claudeMessageList: AnthropicMessageParam[] = [];
                let currentRole: AIRole = AIRole.USER;
                let anthContent: Array<any> = [];
                messageList.forEach((msg, index) => {
                    const role = msg.role === AIRole.ASSISTANT && msg.content.find(c => c.type === 'image') ? AIRole.USER : msg.role;
                    if (role !== currentRole) { // Change role or if it's the last message
                        if (anthContent.length > 0) {
                            claudeMessageList.push({role: currentRole as any, content: anthContent});
                            anthContent = []; // Reset for the next block of messages
                        }
                        currentRole = role; // Ensure role alternation
                    }

                    // Add content to the current block
                    msg.content.forEach(c => {
                        if (['text', 'audio'].includes(c.type)) anthContent.push({
                            type: 'text',
                            text: JSON.stringify({message: c.value, author: msg.name, type: c.type})
                        });
                        if (['image'].includes(c.type)) anthContent.push({
                            type: 'image',
                            source: {data: c.value!, media_type: c.media_type as any, type: 'base64'}
                        });
                    });
                });
                // Ensure the last block is not left out
                if (anthContent.length > 0) claudeMessageList.push({role: currentRole, content: anthContent});

                // Ensure the first message is always AiRole.USER (by API requirement)
                if (claudeMessageList.length > 0 && claudeMessageList[0].role !== AIRole.USER) {
                    claudeMessageList.shift(); // Remove the first element if it's not USER
                }

                return claudeMessageList;

            case AIProvider.DEEPSEEK:

                const deepSeekMsgList: any[] = [];
                messageList.forEach(msg => {
                    if (msg.role == AIRole.ASSISTANT) {
                        const textContent = msg.content.find(c => ['text', 'audio'].includes(c.type))!;
                        const content = JSON.stringify({
                            type: 'text',
                            text: JSON.stringify({message: textContent.value, author: msg.name, type: textContent.type, response_format: "json_object"})
                        });
                        deepSeekMsgList.push({content: content, name: msg.name!, role: msg.role});
                    } else {
                        const gptContent: Array<any> = [];
                        msg.content.forEach(c => {
                            if (['image'].includes(c.type)) gptContent.push({
                                type: 'text',
                                text: JSON.stringify({message: getUnsupportedMessage('image', ''), author: msg.name, type: c.type, response_format: "json_object"})
                            });
                            if (['text', 'audio'].includes(c.type)) gptContent.push({
                                type: 'text',
                                text: JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format: "json_object"})
                            });
                        })
                        deepSeekMsgList.push({content: gptContent, name: msg.name!, role: msg.role});
                    }
                })

                deepSeekMsgList.unshift({role: AIRole.SYSTEM, content: [{type: 'text', text: systemPrompt}]});

                return deepSeekMsgList;

            case AIProvider.OPENAI:

                const responseAPIMessageList: ResponseInput = [];
                messageList.forEach(msg => {
                    const gptContent: Array<any> = [];
                    msg.content.forEach(c => {
                        const fromBot = msg.role == AIRole.ASSISTANT;
                        if (['text', 'audio'].includes(c.type))  gptContent.push({ type: fromBot?'output_text':'input_text', text: JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format:'json_object'}) });
                        if (['image'].includes(c.type))          gptContent.push({ type: 'input_image', image_url: `data:${c.media_type};base64,${c.value}`});
                    })
                    responseAPIMessageList.push({content: gptContent, role: msg.role});
                })

                responseAPIMessageList.unshift({role: AIRole.SYSTEM, content: systemPrompt});
                return responseAPIMessageList;

            case AIProvider.QWEN:
                const chatgptMessageList: any[] = [];
                messageList.forEach(msg => {
                    const gptContent: Array<any> = [];
                    msg.content.forEach(c => {
                        if (['text', 'audio'].includes(c.type)) gptContent.push({
                            type: 'text',
                            text: JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format: 'json_object'})
                        });
                        if (['image'].includes(c.type)) gptContent.push({type: 'image_url', image_url: {url: `data:${c.media_type};base64,${c.value}`}});
                    })
                    chatgptMessageList.push({content: gptContent, name: msg.name!, role: msg.role});
                })

                chatgptMessageList.unshift({role: AIRole.SYSTEM, content: [{type: 'text', text: systemPrompt}]});

                return chatgptMessageList;

            case AIProvider.CUSTOM:
            case AIProvider.DEEPINFRA:

                const otherMsgList: any[] = [];
                messageList.forEach(msg => {
                    if (msg.role == AIRole.ASSISTANT) {
                        const textContent = msg.content.find(c => ['text', 'audio'].includes(c.type))!;
                        const content = JSON.stringify({message: textContent.value, author: msg.name, type: textContent.type, response_format: "json_object"});
                        otherMsgList.push({content: content, name: msg.name!, role: msg.role});
                    } else {
                        const gptContent: Array<any> = [];
                        msg.content.forEach(c => {
                            if (['image'].includes(c.type)) gptContent.push(JSON.stringify({message: getUnsupportedMessage('image', ''), author: msg.name, type: c.type, response_format: "json_object"}));
                            if (['text', 'audio'].includes(c.type)) gptContent.push(JSON.stringify({message: c.value, author: msg.name, type: c.type, response_format: "json_object"}));
                        })
                        otherMsgList.push({content: gptContent[0], role: msg.role});
                    }
                })

                otherMsgList.unshift({role: AIRole.SYSTEM, content: systemPrompt});

                return otherMsgList;

            default:
                return [];
        }
    }

    /**
     * Transcribes a voice message to text using AI services.
     *
     * This function:
     * 1. Checks if the transcription already exists in cache
     * 2. Converts the media to an audio buffer and stream
     * 3. Sends the audio to the configured transcription service
     * 4. Caches the result for future use
     *
     * The function uses the OpenAI service which may route to different
     * providers based on configuration.
     *
     * @param media - The MessageMedia object containing the voice data
     * @param message - The Message object for cache identification
     * @returns A promise resolving to the transcribed text
     */
    private async transcribeVoice(media: MessageMedia, message: Message): Promise<string> {
        try {

            // Check if the transcription exists in the cache
            const cachedMessage = this.getCachedMessage(message);
            if (cachedMessage) return cachedMessage;

            // Convert the base64 media data to a Buffer
            const audioBuffer = Buffer.from(media.data, 'base64');

            // Convert the buffer to a stream
            const audioStream = bufferToStream(audioBuffer);

            logger.debug(`[${AIConfig.TranscriptionConfig.provider}->transcribeVoice] Starting audio transcription`);

            const transcribedText = await RobotoInstance.openAIService.transcription(audioStream);

            // Log the transcribed text
            logger.debug(`[${AIConfig.TranscriptionConfig.provider}->transcribeVoice] Transcribed text: ${transcribedText}`);

            // Store in cache
            this._cache.set(message.id._serialized, transcribedText, CONFIG.botConfig.nodeCacheTime);

            return transcribedText;

        } catch (error: any) {
            // Error handling
            logger.error(`Error transcribing voice message: ${error.message}`);
            return '<Error transcribing voice message>';
        }
    }

    /**
     * Retrieves a cached message by its unique identifier.
     *
     * This function checks the NodeCache instance for previously stored
     * message content, such as transcriptions or generated responses.
     *
     * @param msg - The Message object whose content might be cached
     * @returns The cached string content or undefined if not found
     */
    private getCachedMessage(msg: Message) {
        return this._cache.get<string>(msg.id._serialized);
    }

    get cache(): NodeCache {
        return this._cache;
    }
}