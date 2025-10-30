import { Tool } from "openai/src/resources/responses/responses";
import { AIProvider } from "../interfaces/ai-interfaces";
import { AIConfig, CONFIG } from "./index";
import { convertCompletionsToolsToResponses } from "../utils";
import { Chat } from "whatsapp-web.js";

const openAIWebSearch: Tool =
    {
        type: "web_search",
        user_location: {
            type: "approximate"
        },
        search_context_size: "medium"
    }
;

const generate_speech = {
    type: "function",
    function: {
        name: "generate_speech",
        description: "Generates a voice audio from text using AI. Instructions for tone and style can be customized.",
        parameters: {
            type: "object",
            properties: {
                input: {
                    type: "string",
                    description: "The text to be converted into audio."
                },
                instructions: {
                    type: "string",
                    description: "Instructions for the TTS model regarding intonation and style, such as emotion, tone, or accent."
                },
                msg_id: {
                    type: "string",
                    description: "msg_id of the message where the audio generation request was made."
                },
                voice_gender:{
                    type: "string",
                    enum: ["male", "female","undefined"],
                    description: "The gender of the voice to be used."
                }
            },
            required: ["input", "instructions", "msg_id"],
            additionalProperties: false
        }
    },
    strict: false
}
const generate_image = {
    type: "function",
    function: {
        name: "generate_image",
        description:`Generate images from text prompt`,
        parameters: {
            type: "object",
            properties: {
                msg_id: {
                    type: "string",
                    description: "msg_id of the message where the image generation request was made."
                },
                chatId: {
                    type: "string",
                    description: "chatId of the actual chat."
                },
                prompt: { type: "string", description: 'Description of the image to generate' },
                background: { type: ["string","null"], enum: ["opaque","transparent","auto"], description: "Transparent or opaque background. OPTIONAL", nullable: true },
                output_format: { type: ["string","null"], enum: ["png","jpg","webp"], description: "Default png. OPTIONAL", nullable: true },
                quality: { type: ["string","null"], enum: ["medium","high" ,"auto"], description: "The quality of the image that will be generated. Default \"auto\". OPTIONAL", nullable: true },
                send_as: {
                    type: ["string", "null"],
                    enum: ["image", "sticker"],
                    description: "Determines whether the generated media will be sent as an image or as a sticker. OPTIONAL. Default: \"image\".",
                    nullable: true,
                    default: "image"
                },
                size: { type: ["string","null"], enum: ["1024x1024", "1536x1024", "1024x1536", "auto"], description: "The size of the generated images. Default \"auto\". OPTIONAL", nullable: true },
                style: { type: ["string","null"], enum: ["vivid","natural"], description: "Vivid causes the model to lean * towards generating hyper-real and dramatic images. Natural causes the model to * produce more natural, less hyper-real looking images. OPTIONAL", nullable: true },
            },
            required: ["msg_id","chatId","prompt"],
            additionalProperties: false
        }
    },
    strict: true
}
const generate_image_withedit = {
    type: "function",
    function: {
        name: "generate_image",
        description:
            `Generate or edit images. Use this function to:
    - Create NEW images from scratch (when no reference images are provided)
    - Transform or edit existing images (when reference images are provided),
    - Auto-reference policy: If the user’s request mentions a known person from the group by name or alias, the assistant MUST automatically map that name to its image_msg_id and include it in image_msg_ids. The user does not need to ask explicitly. If multiple people are mentioned, include all corresponding image_msg_ids in the mentioned order. If there is ambiguity, ask for clarification. Never place real names or msg_ids inside the prompt text; always refer to subjects as 'the person in the first image', 'the person in the second image', etc.`,
        parameters: {
            type: "object",
            properties: {
                msg_id: {
                    type: "string",
                    description: "msg_id of the message where the image generation request was made."
                },
                chatId: {
                    type: "string",
                    description: "chatId of the actual chat."
                },
                prompt: { type: "string", description: 'Description of the image to generate or changes to apply. Important: Never use real person names or msg_id in the prompt; always refer to subjects as "the person in the first image", etc.' },
                image_msg_ids: {
                    type: ["array", "null"],
                    description: "Array of image msg_ids to use as references. Required when: (a) the user asks to modify or edit one or more existing images in the chat; or (b) the request refers to a specific person (e.g., 'edit my friend', 'make a version of me'), in which case include the msg_id(s) of that person's photo(s) as reference. " +
                        "Leave null or empty only when generating from scratch, without editing existing images, without mentioning a specific person, or if you don't have an image_id for the person mentioned.",
                    items: { type: "string" },
                    nullable: true
                },
                background: { type: ["string","null"], enum: ["opaque","transparent","auto"], description: "Transparent or opaque background. OPTIONAL", nullable: true },
                output_format: { type: ["string","null"], enum: ["png","jpg","webp"], description: "Default png. OPTIONAL", nullable: true },
                quality: { type: ["string","null"], enum: ["medium","high" ,"auto"], description: "The quality of the image that will be generated. Default \"auto\". OPTIONAL", nullable: true },
                send_as: {
                    type: ["string", "null"],
                    enum: ["image", "sticker"],
                    description: "Determines whether the generated media will be sent as an image or as a sticker. OPTIONAL. Default: \"image\".",
                    nullable: true,
                    default: "image"
                },
                size: { type: ["string","null"], enum: ["1024x1024", "1536x1024", "1024x1536", "256x256", "512x512", "1792x1024", "1024x1792", "auto"], description: "The size of the generated images. Default \"auto\". OPTIONAL", nullable: true },
                style: { type: ["string","null"], enum: ["vivid","natural"], description: "Vivid causes the model to lean * towards generating hyper-real and dramatic images. Natural causes the model to * produce more natural, less hyper-real looking images. OPTIONAL", nullable: true },
            },
            required: ["msg_id","chatId","prompt"],
            additionalProperties: false
        }
    },
    strict: false
}
const reminder_manager = {
    type: "function",
    strict: false,
    function: {
        name: "reminder_manager",
        description: `Complete reminder management system with recurrence support. Use this function to:
    - LIST/GET: Retrieve all pending reminders for the user or group (use action 'list')
    - CREATE: Add new reminders with a message, date/time, and optional recurrence (use action 'create')
    - UPDATE: Modify existing reminders by their ID (use action 'update') 
    - DELETE: Remove reminders by their ID (use action 'delete')
    - DEACTIVATE: Temporarily disable a reminder (use action 'deactivate')
    - REACTIVATE: Re-enable a disabled reminder (use action 'reactivate')
    
    Recurrence types: 'none', 'minutes', 'daily', 'weekly', 'monthly'
    Always use 'list' first to get reminder IDs before updating or deleting.`,
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["list", "create", "update", "delete", "deactivate", "reactivate"],
                    description: "Action to perform on reminders"
                },
                message: {
                    type: ["string", "null"],
                    description: "The reminder message text. REQUIRED for 'create' and 'update' actions.",
                    nullable: true
                },
                reminder_date: {
                    type: ["string", "null"],
                    description: "When the reminder should trigger, in yyyy-MM-ddTHH:mm:ss format (e.g., '2024-12-25T10:30:00'). REQUIRED for 'create' and 'update' actions.",
                    nullable: true
                },
                reminder_date_timezone: {
                    type: ["string", "null"],
                    description: `Specifies the IANA timezone (e.g., 'America/Santiago') that applies to the reminder date and time. By default, '${CONFIG.BotConfig.botTimezone}' will be used.`,
                    nullable: true
                },
                reminder_id: {
                    type: ["string", "null"],
                    description: "The unique identifier of the reminder. REQUIRED for 'update', 'delete', 'deactivate', and 'reactivate' actions.",
                    nullable: true
                },
                recurrence_type: {
                    type: ["string", "null"],
                    enum: ["none", "minutes", "daily", "weekly", "monthly"],
                    description: "Type of recurrence for the reminder. 'none' for one-time reminders. Optional for 'create' and 'update' actions.",
                    nullable: true
                },
                recurrence_interval: {
                    type: ["number", "null"],
                    description: "Interval for recurrence (e.g., 2 for every 2 days/weeks/months). Default is 1. Optional for 'create' and 'update' actions.",
                    nullable: true
                },
                recurrence_end_date: {
                    type: ["string", "null"],
                    description: "End date for recurrence in yyyy-MM-ddTHH:mm:ss format. Optional for 'create' and 'update' actions.",
                    nullable: true
                },
                recurrence_end_date_timezone: {
                    type: ["string", "null"],
                    description: `Timezone for the recurrence end date. By default, '${CONFIG.BotConfig.botTimezone}' will be used.`,
                    nullable: true
                },
                msg_id: {
                    type: "string",
                    description: "msg_id of the message where request was made"
                }
            },
            required: ["action","msg_id"],
            additionalProperties: false
        }
    }
}

const user_memory_manager = {
    "type": "function",
    "strict": false,
    "function": {
        "name": "user_memory_manager",
        "description": "Call this function whenever you learn new or updated user details (name, age, interests, etc.)—no need to wait for a request. " +
            "Always keep memory accurate for better, personalized responses.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["get", "save", "clear"],
                    "description": "'get' to retrieve user memory, 'save' to update it, 'clear' to delete user memory."
                },
                "chat_id": {
                    "type": "string",
                    "description": "Chat identifier (context of the user)."
                },
                "author_id": {
                    "type": "string",
                    "description": "Author ID (required)."
                },
                "memory_data": {
                    "type": ["object", "null"],
                    "description": "Full object to store as user memory. Provide all fields when saving; replaces existing memory.",
                    "properties": {
                        "real_name": { "type": ["string", "null"], "nullable": true },
                        "nicknames": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "age": { "type": ["number", "null"], "nullable": true },
                        "profession": { "type": ["string", "null"], "nullable": true },
                        "location": { "type": ["string", "null"], "nullable": true },
                        "interests": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "likes": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "dislikes": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "relationships": { "type": ["object", "null"], "nullable": true },
                        "running_jokes": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "jargon": { "type": ["object", "null"], "nullable": true },
                        "notes": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true }
                    },
                    "nullable": true,
                    "additionalProperties": false
                }
            },
            "required": ["action", "chat_id", "author_id"],
            "additionalProperties": false
        }
    }
}
const group_memory_manager = {
    "type": "function",
    "strict": false,
    "function": {
        "name": "group_memory_manager",
        "description": "Call this function when you learn new group info (interests, topics, jokes, etc.). Update memory without waiting for a request.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["get", "save", "clear"],
                    "description": "'get' to retrieve group memory, 'save' to update it, 'clear' to delete group memory."
                },
                "chat_id": {
                    "type": "string",
                    "description": "Unique identifier for the chat/group."
                },
                "memory_data": {
                    "type": ["object", "null"],
                    "description": "Group memory object to save. Replaces existing group memory.",
                    "properties": {
                        "group_interests": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "recurring_topics": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "group_likes": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "group_dislikes": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "group_jargon": { "type": ["object", "null"], "nullable": true },
                        "group_running_jokes": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true },
                        "group_notes": { "type": ["array", "null"], "items": { "type": "string" }, "nullable": true }
                    },
                    "nullable": true,
                    "additionalProperties": false
                }
            },
            "required": ["action", "chat_id"],
            "additionalProperties": false
        }
    }
}

export function getTools(chatData: Chat) {

    const tools = [];
    if(AIConfig.ImageConfig.enabled) tools.push(AIConfig.ImageConfig.catEditImages? generate_image_withedit : generate_image);
    tools.push(reminder_manager);
    if(AIConfig.TranscriptionConfig.enabled) tools.push(generate_speech);
    if(CONFIG.BotConfig.memoriesEnabled) {
        tools.push(user_memory_manager);
         if(chatData.isGroup) tools.push(group_memory_manager);
    }

    switch (AIConfig.ChatConfig.provider) {
        case AIProvider.CLAUDE:
            return openaiToolsToClaudeTools(tools);
        case AIProvider.OPENAI:
            return [...convertCompletionsToolsToResponses(tools), openAIWebSearch]
        default:
            return tools;
    }
}

function openaiToolsToClaudeTools(inputTools) {
    return inputTools
        .filter(tool => tool.type === "function" && tool.function)
        .map(tool => {
            const fn = tool.function;
            return {
                name: fn.name,
                description: fn.description,
                input_schema: fn.parameters
            };
        });
}