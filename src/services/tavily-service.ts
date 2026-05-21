import axios from 'axios';
import logger from '../logger';
import { CONFIG } from '../config';
import { OperationResult } from '../interfaces/ai-interfaces';

const TAVILY_API_URL = 'https://api.tavily.com/search';

export interface TavilySearchArgs {
  query: string;
  search_depth?: 'basic' | 'advanced';
  max_results?: number;
  topic?: string;
  time_range?: string;
  include_answer?: boolean;
  include_raw_content?: boolean;
}

class TavilyService {
  async search(args: TavilySearchArgs): Promise<OperationResult> {
    const apiKey = CONFIG.SearchConfig.tavilyApiKey;

    if (!apiKey) {
      return { success: false, result: 'Web search is not configured: missing TAVILY_API_KEY.' };
    }

    const payload = {
      query: args.query,
      search_depth: args.search_depth ?? CONFIG.SearchConfig.searchDepth,
      max_results: args.max_results ?? CONFIG.SearchConfig.maxResults,
      topic: args.topic ?? 'general',
      time_range: args.time_range ?? null,
      include_answer: args.include_answer ?? CONFIG.SearchConfig.includeAnswer,
      include_raw_content: args.include_raw_content ?? CONFIG.SearchConfig.includeRawContent,
      include_images: false,
      include_favicon: true,
    };

    try {
      const response = await axios.post(TAVILY_API_URL, payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const data = response.data;

      const normalized = {
        query: data.query,
        answer: data.answer ?? null,
        results: (data.results ?? []).map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          score: r.score,
        })),
        usage: data.usage ?? null,
      };

      return { success: true, result: normalized };
    } catch (err: any) {
      const status = err?.response?.status;
      const message = err?.response?.data?.message ?? err?.message ?? 'Unknown error';
      logger.error(`[TavilyService] search failed (status=${status}): ${message}`);
      return { success: false, result: `Web search failed (${status ?? 'network error'}): ${message}` };
    }
  }
}

const TavilySvc = new TavilyService();
export default TavilySvc;
