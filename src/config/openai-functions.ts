import {Tool} from "openai/src/resources/responses/responses";

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
                    description: "The name of the voice to use (e.g., 'coral', 'alloy', 'ash', 'onyx'). Optional."
                }
            },
            required: ["input", "instructions", "voice"],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: "function",
        name: "create_image",
        description: `Generate NEW images from a text. Use it only when the user requests to create an image from scratch and does NOT provide any prior image as a reference.`,
        parameters: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Description of the image to generate." },
                background: { type: ["string","null"], enum: ["opaque","transparent","auto"], description: "Transparent or opaque background. OPTIONAL", nullable: true },
                wait_message: { type: ["string", "null"], description: "Message sent to the user at the start of processing asking them to please wait one minute. OPTIONAL.", nullable: true }
            },
            required: ["prompt", "background", "wait_message"],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: "function",
        name: "transform_image",
        description: `Create, transform, or edit images using one or more provided reference images (in base64 format). Use this function both for subtle modifications and for generating new images that are based on the input images (for example, changing the artistic style, merging elements, or reinterpreting the scene). At least one reference image is always required as a base. Important: never use real person names in the prompt; always refer to subjects as "the person in the first image", etc. Do not use this function to create images entirely from scratch without reference images.`,
        parameters: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Description of the changes to apply or image to generate    ." },
                imageIds: {
                    type: "array",
                    description: "Each element is the imageId of the image to use.",
                    items: { type: "string" }
                },
                mask: { type: ["string","null"], description: "Base64 of the mask (PNG with alpha channel). OPTIONAL", nullable: true },
                background: { type: ["string","null"], enum: ["opaque","transparent","auto"], description: "Transparent or opaque background. OPTIONAL", nullable: true },
                wait_message: { type: ["string", "null"], description: "Message sent to the user at the start of processing asking them to please wait one minute. OPTIONAL.", nullable: true }
            },
            required: ["prompt","imageIds","mask","background", "wait_message"],
            additionalProperties: false
        },
        strict: true
    }
];
