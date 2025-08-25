import { Tool } from "openai/src/resources/responses/responses";
import { AIProvider } from "../interfaces/ai-interfaces";
import { AIConfig, CONFIG } from "./index";
import { convertCompletionsToolsToResponses } from "../utils";
import { Chat } from "whatsapp-web.js";

const openAIWebSearch: Tool =
    {
        type: "web_search_preview",
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
                background: { type: ["string","null"], enum: ["opaque","transparent","auto"], description: "Transparent or opaque background. OPTIONAL", nullable: true }
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
    - Transform or edit existing images (when reference images are provided)`,
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
                    description: "Array de msg_ids of images to use as a reference. Leave null or empty to create from scratch. (Optional)",
                    items: { type: "string" },
                    nullable: true
                },
                background: { type: ["string","null"], enum: ["opaque","transparent","auto"], description: "Transparent or opaque background. OPTIONAL", nullable: true }
            },
            required: ["msg_id","chatId","prompt"],
            additionalProperties: false
        }
    },
    strict: false
}
// const group_memory_manager = {
//     type: "function",
//     strict: false,
//     function: {
//         name: "group_memory_manager",
//         description: `Group memory management system. Use this ONLY in group chats to remember and recall information about the group as a whole. This includes:
//         - Group interests and common preferences
//         - Recurring topics of discussion
//         - Group culture, traditions, and habits
//         - Group-specific jargon and inside jokes
//         - General group dynamics and characteristics
//
//         IMPORTANT: Only use this function when in a group chat and only store information that is clearly about the group collectively, not individual members.`,
//         parameters: {
//             type: "object",
//             properties: {
//                 action: {
//                     type: "string",
//                     enum: ["get", "update", "delete"],
//                     description: "Action to perform: 'get' to retrieve group memory, 'update' to add/modify group information, 'delete' to remove group memory"
//                 },
//                 chat_id: {
//                     type: "string",
//                     description: "The group chat ID"
//                 },
//                 chat_name: {
//                     type: ["string", "null"],
//                     description: "Group chat name. Required for 'update' action.",
//                     nullable: true
//                 },
//                 group_interests: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Common interests of the group members",
//                     nullable: true
//                 },
//                 recurring_topics: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Topics frequently discussed in the group",
//                     nullable: true
//                 },
//                 group_likes: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Things the group generally likes or enjoys",
//                     nullable: true
//                 },
//                 group_dislikes: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Things the group generally dislikes or avoids",
//                     nullable: true
//                 },
//                 group_jargon: {
//                     type: ["object", "null"],
//                     description: "Group-specific slang/jargon terms with their meanings as key-value pairs",
//                     nullable: true
//                 },
//                 group_running_jokes: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Inside jokes or recurring references specific to this group",
//                     nullable: true
//                 },
//                 group_traditions: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Group habits, traditions, or regular activities",
//                     nullable: true
//                 },
//                 group_notes: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "General notes about the group dynamics, culture, or characteristics",
//                     nullable: true
//                 }
//             },
//             required: ["action", "chat_id"],
//             additionalProperties: false
//         }
//     }
// }
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
// const user_memory_manager = {
//     type: "function",
//     strict: false,
//     function: {
//         name: "user_memory_manager",
//         description: `User memory management system. Use this to remember and recall personal information about individual users for more personalized conversations. This includes:
//         - Personal details (age, profession, location)
//         - Interests, likes, and dislikes
//         - Relationships and family info
//         - Running jokes and nicknames
//         - Personal notes and jargon
//
//         IMPORTANT: Only store information that users explicitly mention or that is clearly evident from the conversation.`,
//         parameters: {
//             type: "object",
//             properties: {
//                 action: {
//                     type: "string",
//                     enum: ["get", "update", "delete"],
//                     description: "Action to perform: 'get' to retrieve memories, 'update' to add/modify information, 'delete' to remove a user's memory"
//                 },
//                 chat_id: {
//                     type: "string",
//                     description: "The chat/group ID"
//                 },
//                 author_id: {
//                     type: ["string", "null"],
//                     description: "User's unique ID. Required for 'update' and 'delete'. If not provided for 'get', returns all user memories in the chat.",
//                     nullable: true
//                 },
//                 author_name: {
//                     type: ["string", "null"],
//                     description: "User's display name. Required for 'update' action.",
//                     nullable: true
//                 },
//                 age: {
//                     type: ["integer", "null"],
//                     description: "User's age",
//                     nullable: true
//                 },
//                 profession: {
//                     type: ["string", "null"],
//                     description: "User's job or profession",
//                     nullable: true
//                 },
//                 location: {
//                     type: ["string", "null"],
//                     description: "User's location (city, country, etc.)",
//                     nullable: true
//                 },
//                 interests: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "User's hobbies and interests",
//                     nullable: true
//                 },
//                 likes: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Things the user likes",
//                     nullable: true
//                 },
//                 dislikes: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Things the user dislikes",
//                     nullable: true
//                 },
//                 relationships: {
//                     type: ["object", "null"],
//                     description: "Information about user's family, partner, friends, etc.",
//                     nullable: true
//                 },
//                 running_jokes: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Recurring jokes or references with this user",
//                     nullable: true
//                 },
//                 nicknames: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "User's nicknames or alternate names",
//                     nullable: true
//                 },
//                 personal_notes: {
//                     type: ["array", "null"],
//                     items: { type: "string" },
//                     description: "Array of relevant personal information about the user",
//                     nullable: true
//                 },
//                 jargon: {
//                     type: ["object", "null"],
//                     description: "User's personal slang/jargon terms with their meanings as key-value pairs (e.g., {'bro': 'friend', 'lit': 'amazing'})",
//                     nullable: true
//                 }
//             },
//             required: ["action", "chat_id"],
//             additionalProperties: false
//         }
//     }
// }

const memory_manager = {
    type: "function",
    strict: false,
    function: {
        name: "memory_manager",
        description: `Unified memory management system for both user and group memories. Use this to:
        - Store and retrieve personal user information in any chat context
        - Store and retrieve group-specific information in group chats only
        - Perform granular updates without overwriting entire fields
        - Maintain conversation context and personalization

        AVAILABLE FIELDS BY SCOPE:
        
        USER FIELDS:
        • Basic: age(number), profession(string), location(string)
        • Arrays: interests, likes, dislikes, runningJokes, nicknames, personalNotes
        • Objects: relationships(object), jargon(object)
        
        GROUP FIELDS:
        • Arrays: groupInterests, recurringTopics, groupLikes, groupDislikes, groupRunningJokes, groupTraditions, groupNotes
        • Objects: groupJargon(object)
        
        OPERATIONS:
        • set: Replace field values completely
        • add: Add items to arrays (with deduplication)
        • remove: Remove specific items from arrays
        • delete_fields: Delete entire fields (cannot delete required fields)`,
        parameters: {
            type: "object",
            properties: {
                scope: {
                    type: "string",
                    enum: ["user", "group"],
                    description: "Memory scope: 'user' for personal memories, 'group' for group memories (group chats only)"
                },
                action: {
                    type: "string",
                    enum: ["get", "upsert", "patch", "delete"],
                    description: "Action: 'get' retrieves, 'upsert' creates/updates, 'patch' modifies existing, 'delete' removes"
                },
                target: {
                    type: "object",
                    strict: false,
                    properties: {
                        chat_id: { type: "string", description: "Chat identifier" },
                        author_id: {
                            type: ["string", "null"],
                            description: "User ID (required for user scope)",
                            nullable: true
                        },
                        author_name: {
                            type: ["string", "null"],
                            description: "User display name (required for user upsert/patch)",
                            nullable: true
                        },
                        chat_name: {
                            type: ["string", "null"],
                            description: "Group name (required for group upsert/patch)",
                            nullable: true
                        }
                    },
                    required: ["chat_id"],
                    additionalProperties: false
                },
                ops: {
                    type: ["object", "null"],
                    description: "Operations for upsert/patch actions. See main description for available fields by scope.",
                    properties: {
                        set: {
                            type: ["object", "null"],
                            description: "Set/replace field values. Use any available field from the scope section above.",
                            nullable: true,
                            additionalProperties: true
                        },
                        add: {
                            type: ["object", "null"],
                            description: "Add items to array fields. Only works with array fields listed above.",
                            nullable: true,
                            additionalProperties: true
                        },
                        remove: {
                            type: ["object", "null"],
                            description: "Remove items from array fields. Only works with array fields listed above.",
                            nullable: true,
                            additionalProperties: true
                        },
                        delete_fields: {
                            type: ["array", "null"],
                            items: { type: "string" },
                            description: "Delete entire fields. Cannot delete required fields (chatId, authorId, authorName, isGroup for users; chatId, chatName for groups)",
                            nullable: true
                        }
                    },
                    nullable: true,
                    additionalProperties: false
                },
                source_msg_id: {
                    type: ["string", "null"],
                    description: "Source message ID for provenance tracking",
                    nullable: true
                }
            },
            required: ["scope", "action", "target"],
            additionalProperties: false
        }
    }
}

export function getTools(chatData: Chat) {

    const tools = [];
    if(AIConfig.ImageConfig.enabled) tools.push(AIConfig.ImageConfig.catEditImages? generate_image_withedit : generate_image);
    tools.push(reminder_manager);
    if(AIConfig.TranscriptionConfig.enabled) tools.push(generate_speech);
    if(CONFIG.BotConfig.memoriesEnabled) {
        tools.push(memory_manager);
        // if(chatData.isGroup) tools.push(group_memory_manager);
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