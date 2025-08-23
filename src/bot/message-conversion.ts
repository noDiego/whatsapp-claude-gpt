import { AiMessage, AIProvider, AIRole } from "../interfaces/ai-interfaces";
import { ResponseInputItem } from "openai/resources/responses/responses";
import { ChatCompletionMessageParam } from "openai/resources";
import { MessageParam } from "@anthropic-ai/sdk/resources";
import { CONFIG } from "../config";
import { getUnsupportedMessage } from "../utils";

// Constants
const ATTACHMENT_FALLBACK_MSG =
    "SYSTEM: this message is only to include the msg_id of the attached file/image. Do not mention msg_id in the chat";

// Type guards and helpers
const isTextLike = (t: string) => t === "text" || t === "ASR";
const hasTextOrASR = (m: AiMessage) => m.content.some(c => isTextLike(c.type));
const toDataUri = (mimetype: string, value: string) =>
    `data:${mimetype};base64,${value}`;

type BaseMeta = {
    message: string;
    msg_id: string | number | undefined;
    type: string;
    author_id?: string | number;
    author_name?: string | null;
    date?: string | undefined;
};

// Builds the common metadata payload for text-like messages
function buildMeta(
    aiMessage: AiMessage,
    c: any,
    overrides?: Partial<Pick<BaseMeta, "message" | "type">>
): BaseMeta {
    return {
        message: overrides?.message ?? c.value,
        msg_id: c.msg_id,
        type: overrides?.type ?? c.type,
        author_id: c.author_id,
        author_name: aiMessage.name,
        date: c.dateString
    };
}

// -- Provider specific converters (kept small by reusing helpers) --

// Claude converter
function toClaude(messageList: AiMessage[]): MessageParam[] {
    const claudeMessageList: MessageParam[] = [];
    let currentRole: AIRole = AIRole.USER;
    let block: Array<any> = [];

    const pushBlock = () => {
        if (block.length > 0) {
            claudeMessageList.push({ role: currentRole as any, content: block });
            block = [];
        }
    };

    for (const aiMessage of messageList) {
        // If assistant sends an image, Claude requires user role for that block
        const role =
            aiMessage.role === AIRole.ASSISTANT &&
            aiMessage.content.some(c => c.type === "image")
                ? AIRole.USER
                : aiMessage.role;

        const hasText = hasTextOrASR(aiMessage);

        if (role !== currentRole) {
            pushBlock();
            currentRole = role;
        }

        for (const c of aiMessage.content) {
            if (isTextLike(c.type)) {
                // Claude text: wrap metadata as JSON string inside a "text" block
                block.push({
                    type: "text",
                    text: JSON.stringify(
                        buildMeta(aiMessage, c, { type: c.type }) // keep original behavior: "type":"text"
                    )
                });
            } else if (c.type === "image") {
                block.push({
                    type: "image",
                    source: {
                        data: c.value!,
                        media_type: c.mimetype as any,
                        type: "base64"
                    }
                });
                if (!hasText) {
                    // Inject a metadata carrier if the message only has an image
                    block.push({
                        type: "text",
                        text: JSON.stringify(
                            buildMeta(aiMessage, c, {
                                message: ATTACHMENT_FALLBACK_MSG,
                                type: "text"
                            })
                        )
                    });
                }
            }
        }
    }

    pushBlock();

    // Claude requires the first message to be "user"
    if (claudeMessageList.length > 0 && claudeMessageList[0].role !== AIRole.USER) {
        claudeMessageList.shift();
    }

    return claudeMessageList;
}

// DeepSeek converter
function toDeepSeek(messageList: AiMessage[]): any[] {
    const deepSeekMsgList: any[] = [];

    for (const aiMessage of messageList) {
        if (aiMessage.role === AIRole.ASSISTANT) {
            // Roboto: single text item as stringified wrapper
            const textContent = aiMessage.content.find(c => isTextLike(c.type))!;
            const content = JSON.stringify({
                type: "text",
                text: JSON.stringify(buildMeta(aiMessage, textContent))
            });
            deepSeekMsgList.push({
                content,
                name: aiMessage.name!,
                role: aiMessage.role
            });
        } else {
            // User: array of text blocks, images are not supported (send unsupported text)
            const gptContent: Array<any> = [];
            for (const c of aiMessage.content) {
                if (c.type === "image" || c.type === "file") {
                    gptContent.push({
                        type: "text",
                        text: JSON.stringify(
                            buildMeta(aiMessage, c, {
                                message: getUnsupportedMessage(c.type, "")
                            })
                        )
                    });
                }
                if (isTextLike(c.type)) {
                    gptContent.push({
                        type: "text",
                        text: JSON.stringify(buildMeta(aiMessage, c))
                    });
                }
            }
            deepSeekMsgList.push({
                content: gptContent,
                name: aiMessage.name!,
                role: aiMessage.role
            });
        }
    }

    return deepSeekMsgList;
}

// OpenAI converter
function toOpenAI(messageList: AiMessage[]): ResponseInputItem[] {
    const responseInputItems: ResponseInputItem[] = [];

    for (const aiMessage of messageList) {
        const fromBot = aiMessage.role === AIRole.ASSISTANT;
        const textType = fromBot ? "output_text" : "input_text";
        const hasText = hasTextOrASR(aiMessage);

        const gptContent: any[] = [];

        for (const c of aiMessage.content) {
            if (c.type === "image") {
                gptContent.push({
                    type: "input_image",
                    image_url: toDataUri(c.mimetype, c.value)
                });
                if (!hasText) {
                    gptContent.push({
                        type: textType,
                        text: JSON.stringify(
                            buildMeta(aiMessage, c, {
                                message: ATTACHMENT_FALLBACK_MSG,
                                type: "text"
                            })
                        )
                    });
                }
            } else if (c.type === "file") {
                gptContent.push({
                    type: "input_file",
                    file_data: toDataUri(c.mimetype, c.value),
                    filename: c.filename
                });
                if (!hasText) {
                    gptContent.push({
                        type: textType,
                        text: JSON.stringify(
                            buildMeta(aiMessage, c, {
                                message: ATTACHMENT_FALLBACK_MSG,
                                type: "text"
                            })
                        )
                    });
                }
            } else if (isTextLike(c.type)) {
                gptContent.push({
                    type: textType,
                    text: JSON.stringify(buildMeta(aiMessage, c))
                });
            }
        }

        responseInputItems.push({
            content: gptContent,
            role: aiMessage.role
        });
    }

    return responseInputItems;
}

// Qwen converter
function toQwen(messageList: AiMessage[]): any[] {
    const chatgptMessageList: any[] = [];

    for (const aiMessage of messageList) {
        const gptContent: Array<any> = [];
        const hasText = hasTextOrASR(aiMessage);

        for (const c of aiMessage.content) {
            if (isTextLike(c.type)) {
                gptContent.push({
                    type: "text",
                    text: JSON.stringify(buildMeta(aiMessage, c))
                });
            }
            if (c.type === "image") {
                gptContent.push({
                    type: "image_url",
                    image_url: { url: toDataUri(c.mimetype, c.value) }
                });
                if (hasText) {
                    gptContent.push(buildMeta(aiMessage, c));
                }
            }
        }

        chatgptMessageList.push({
            content: gptContent,
            name: aiMessage.name!,
            role: aiMessage.role
        });
    }

    return chatgptMessageList;
}

// Custom / DeepInfra converter
function toOther(messageList: AiMessage[]): any[] {
    const otherMsgList: any[] = [];

    for (const aiMessage of messageList) {
        if (aiMessage.role === AIRole.ASSISTANT) {
            const textContent = aiMessage.content.find(c => isTextLike(c.type))!;
            otherMsgList.push({
                content: JSON.stringify(buildMeta(aiMessage, textContent)),
                name: aiMessage.name!,
                role: aiMessage.role
            });
        } else {
            const aggregated: string[] = [];
            for (const c of aiMessage.content) {
                if (c.type === "image" || c.type === "file") {
                    aggregated.push(
                        JSON.stringify(
                            buildMeta(aiMessage, c, {
                                message: getUnsupportedMessage(c.type, "")
                            })
                        )
                    );
                }
                if (isTextLike(c.type)) {
                    aggregated.push(JSON.stringify(buildMeta(aiMessage, c)));
                }
            }
            otherMsgList.push({
                content: aggregated[0],
                role: aiMessage.role
            });
        }
    }

    return otherMsgList;
}

// Public API
export function convertIaMessagesLang(
    messageList: AiMessage[]
): MessageParam[] | ChatCompletionMessageParam[] | ResponseInputItem[] {
    switch (CONFIG.ChatConfig.provider) {
        case AIProvider.CLAUDE:
            return toClaude(messageList);
        case AIProvider.DEEPSEEK:
            return toDeepSeek(messageList);
        case AIProvider.OPENAI:
            return toOpenAI(messageList);
        case AIProvider.QWEN:
            return toQwen(messageList);
        case AIProvider.CUSTOM:
        case AIProvider.DEEPINFRA:
            return toOther(messageList);
        default:
            return [];
    }
}