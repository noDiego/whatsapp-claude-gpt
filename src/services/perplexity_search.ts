import { OpenAI } from "openai";
import { AIConfig } from "../config";

class PerplexityService {

    private perplexityClient: OpenAI;

    constructor() {
        this.perplexityClient = new OpenAI({
            apiKey: AIConfig.SearchConfig.apiKey,
            baseURL: "https://api.perplexity.ai",
        });
    }


    async perplexitySonarSearch(query, user_location) {

        const messages = [
            {
                role: "system",
                content:
                    "You are acting as a web search assistant. Use current web information to answer the search query. " +
                    "Return only the most relevant facts in clear, simple language optimized for another LLM to read. " +
                    "Avoid speculation, irrelevant details, and unnecessary formatting. " +
                    "Do not explain your process.",
            },
            {
                role: "user",
                content: `Search query: ${query}`,
            },
        ];

        const request = {
            model: "sonar",
            messages,
            temperature: 0.2,

            // Útil para mantener bajo costo.
            search_context_size: "low",

            // Opcional: deja que Perplexity decida si realmente necesita buscar.
            // Para tu caso de tool llamada "web_search", probablemente prefieres false.
            enable_search_classifier: false,

            // Opcional: si quieres forzar idioma de resultados.
            search_language_filter: ["es", "en"],
        } as any;

        if (user_location) {
            request.web_search_options = {
                user_location: {
                    country: user_location,
                },
            };
        }

        const response: any = await this.perplexityClient.chat.completions.create(request);

        const answer = response.choices?.[0]?.message?.content ?? "";

        return {
            answer,
            citations: response.citations ?? [],
            search_results: response.search_results ?? [],
            usage: response.usage ?? null,
        };
    }


}

const PerplexitySvc = new PerplexityService();
export default PerplexitySvc;