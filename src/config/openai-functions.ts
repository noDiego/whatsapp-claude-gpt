import {Tool} from "openai/src/resources/responses/responses";
import { CONFIG } from "./index";

export const AITools: Array<Tool> = [
    {
        type: "function",
        name: "web_search",
        description: "Use this function whenever the user asks to find out, search for, or obtain updated information or internet data.",
        strict: true,
        parameters: {
            type: "object",
            required: [ "query", "country", "region", "city","timezone" ],
            properties: {
                query: { type: "string", description: "Search term to perform the internet search" },
                country: { type: ["string","null"], description: "Two-letter ISO country code (e.g., CL for Chile)", nullable: true },
                region: { type: ["string","null"], description: "Region or state (free text, e.g., Region Metropolitana)", nullable: true },
                city: { type: ["string","null"], description: "City (free text, e.g., Santiago)", nullable: true },
                timezone: { type: ["string","null"], description: "IANA timezone, e.g., America/Santiago", nullable: true }
            },
            additionalProperties: false
        }
    },
    {
        type: "function",
        name: "generate_speech",
        description: "Generates an voice audio from text using the OpenAI TTS model. Instructions for tone and style can be customized, and a voice can optionally be selected.",
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
                voice: {
                    type: ["string", "null"],
                    enum: [
                        "alloy",
                        "ash",
                        "ballad",
                        "coral",
                        "echo",
                        "fable",
                        "onyx",
                        "nova",
                        "sage",
                        "shimmer",
                        "verse"
                    ],
                    description: "The name of the voice to use (e.g., 'coral', 'alloy', 'ash', 'onyx'). Optional.",
                    nullable: true
                }
            },
            required: ["input", "instructions"],
            additionalProperties: false
        },
        strict: false
    },
    {
        type: "function",
        name: "generate_image",
        description: `Generate or edit images. Use this function to:
    - Create NEW images from scratch (when no reference images are provided)
    - Transform or edit existing images (when reference images are provided)
    Important: never use real person names in the prompt; always refer to subjects as "the person in the first image", etc.`,
        parameters: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Description of the image to generate or changes to apply." },
                imageIds: {
                    type: ["array", "null"],
                    description: "Array of imageIds to use as reference. Leave null or empty to create from scratch. (Optional)",
                    items: { type: "string" },
                    nullable: true
                },
                background: { type: ["string","null"], enum: ["opaque","transparent","auto"], description: "Transparent or opaque background. OPTIONAL", nullable: true },
                wait_message: { type: ["string", "null"], description: "Message sent to the user at the start of processing asking them to please wait one minute. OPTIONAL.", nullable: true }
            },
            required: ["prompt"],
            additionalProperties: false
        },
        strict: false
    },
    {
        type: "function",
        name: "reminder_manager",
        description: `Complete reminder management system. Use this function to:
    - LIST/GET: Retrieve all pending reminders for the user or group (use action 'list')
    - CREATE: Add new reminders with a message and date/time (use action 'create')
    - UPDATE: Modify existing reminders by their ID (use action 'update') 
    - DELETE: Remove reminders by their ID (use action 'delete')
    
    Always use 'list' first to get reminder IDs before updating or deleting.`,
        strict: false,
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["list", "create", "update", "delete"],
                    description: "Action to perform: 'list' to get all pending reminders, 'create' to add new reminders, 'update' to modify existing ones, 'delete' to remove reminders"
                },
                message: {
                    type: ["string", "null"],
                    description: "The reminder message text. REQUIRED for 'create' and 'update' actions. Not used for 'list' and 'delete'.",
                    nullable: true
                },
                reminder_date: {
                    type: ["string", "null"],
                    description: "When the reminder should trigger, in yyyy-MM-ddTHH:mm:ss format (e.g., '2024-12-25T10:30:00'). REQUIRED for 'create' and 'update' actions. Not used for 'list' and 'delete'.",
                    nullable: true
                },
                reminder_date_timezone: {
                    type: ["string", "null"],
                    description: `Specifies the IANA timezone (e.g., 'America/Santiago') that applies to the reminder date and time. This field is used only during creation or update of a reminder. You do not need to specify it unless the user explicitly states they are in a different timezone; by default, '${CONFIG.botConfig.botTimezone}' will be used.`,
                    nullable: true
                },
                reminder_id: {
                    type: ["string", "null"],
                    description: "The unique identifier of the reminder. REQUIRED for 'update' and 'delete' actions. Not used for 'list' and 'create'. Get IDs by using action 'list' first.",
                    nullable: true
                }
            },
            required: ["action"],
            additionalProperties: false
        }
    }
];
