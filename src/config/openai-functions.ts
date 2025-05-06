import {Tool} from "openai/src/resources/responses/responses";

export const AITools: Array<Tool> = [
    {
        type: "web_search_preview",
        user_location: {
            type: "approximate"
        },
        search_context_size: "medium"
    },
    {
        type: "function",
        name: "web_search",
        description: "Use this function whenever the user asks to find out, search for, or obtain updated information or internet data.",
        strict: true,
        parameters: {
            type: "object",
            required: [
                "query"
            ],
            properties: {
                query: {
                    type: "string",
                    description: "Search term to perform the internet search"
                }
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
        name: "edit_image",
        description: `Edit, transform or create one or more existing reference images. Use this function only when you have one or more previously provided images (in base64 format) that you wish to modify, restyle, recolor, convert to a specific style (e.g., "Japanese style"), crop, or perform inpainting, etc.
This function always requires at least one reference image as input, and must not be used to create images from scratch without any reference. Changes can be subtle edits or major transformations, as long as they are based on the input image(s). IMPORTANT: do NOT use real group member names in the prompt—refer to the subjects as "the person in the first image," "the person in the second image," etc., so that the API no longer invents or recognizes names, but uses only the attached images as references.`,
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
