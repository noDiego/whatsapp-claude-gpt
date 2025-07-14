import {Tool} from "openai/src/resources/responses/responses";

export const AITools: Array<Tool> = [
    {
        type: "web_search_preview",
        user_location: {
            type: "approximate"
        },
        search_context_size: "medium"
    }
];
