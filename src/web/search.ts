import type { ToolSpec } from '../types';
import type { ToolHandler } from '../workbook/executor';
import { ToolNetworkError, ToolValidationError } from '../workbook/executor';
import { getSearchProvider, type SearchProviderId, type WebAccessProvider } from './providers';

export const WEB_SEARCH: ToolSpec = {
  name: 'web_search',
  description: 'Search the web for current information. Returns result links and snippets by default. Set include_content to true to also get extracted page text per result (supported by some providers; others return snippets only) - prefer this over fetch_url when a site is likely to block cross-origin requests, since fetch_url fails on CORS-blocked pages. If results suggest several distinct datasets or interpretations of the user request, use request_user_choice before fetching large data.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query, non-empty and at most 400 characters' },
      max_results: { type: 'number', description: 'Number of results to return, 1-10, default 5' },
      include_content: { type: 'boolean', description: 'Also return extracted page text per result (truncated), default false. Providers without content extraction ignore this.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  mutating: false,
  runtime: 'none',
};

export interface WebSearchHandlerOptions {
  getProvider: () => WebAccessProvider;
  getApiKey: (provider: SearchProviderId) => string;
  getBaseUrl?: (provider: SearchProviderId) => string | undefined;
  getEngineId?: (provider: SearchProviderId) => string | undefined;
  fetchImpl?: typeof fetch;
}

export function createWebSearchHandler(options: WebSearchHandlerOptions): ToolHandler {
  return async (args) => {
    const query = parseQuery(args.query);
    const maxResults = parseMaxResults(args.max_results);
    const includeContent = parseIncludeContent(args.include_content);
    const providerId = options.getProvider();
    const provider = getSearchProvider(providerId);
    if (!provider) {
      throw new ToolValidationError('No web search provider is configured.');
    }
    const apiKey = options.getApiKey(provider.id).trim();
    if (provider.requiresKey && !apiKey) {
      throw new ToolValidationError(`Missing API key for ${provider.id}.`);
    }

    const controller = new AbortController();
    const results = await provider.search(query, {
      maxResults,
      apiKey,
      baseUrl: options.getBaseUrl?.(provider.id),
      engineId: options.getEngineId?.(provider.id),
      includeContent,
      signal: controller.signal,
      fetchImpl: options.fetchImpl,
    });

    if (!Array.isArray(results)) {
      throw new ToolNetworkError(`${provider.id} returned an invalid result list.`);
    }

    return {
      query,
      provider: provider.id,
      results: results.slice(0, maxResults),
    };
  };
}

function parseQuery(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ToolValidationError('"query" must be a string.');
  }
  const query = value.trim();
  if (!query) throw new ToolValidationError('"query" must be non-empty.');
  if (query.length > 400) throw new ToolValidationError('"query" must be at most 400 characters.');
  return query;
}

function parseMaxResults(value: unknown): number {
  if (value === undefined || value === null) return 5;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolValidationError('"max_results" must be a number.');
  }
  return Math.min(Math.max(Math.floor(value), 1), 10);
}

function parseIncludeContent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') {
    throw new ToolValidationError('"include_content" must be a boolean.');
  }
  return value;
}
