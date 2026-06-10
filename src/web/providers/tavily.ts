import { ToolNetworkError } from '../../workbook/executor';
import type { SearchProviderAdapter, SearchResult } from './index';

interface TavilyResponse {
  results?: Array<{
    title?: unknown;
    url?: unknown;
    content?: unknown;
    published_date?: unknown;
  }>;
}

export const tavilyProvider: SearchProviderAdapter = {
  id: 'tavily',
  label: 'Tavily',
  requiresKey: true,
  endpoint: 'https://api.tavily.com/search',
  signupUrl: 'https://app.tavily.com/home',

  async search(query, opts): Promise<SearchResult[]> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(opts.baseUrl ?? this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: opts.maxResults,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: opts.signal,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new ToolNetworkError(`tavily request failed: ${message}`);
    }

    if (!response.ok) {
      throw new ToolNetworkError(`tavily request failed with HTTP ${response.status}`);
    }

    let json: TavilyResponse;
    try {
      json = await response.json() as TavilyResponse;
    } catch {
      throw new ToolNetworkError('tavily response was not valid JSON');
    }

    return (json.results ?? [])
      .map(result => normalizeResult(result))
      .filter((result): result is SearchResult => !!result);
  },
};

function normalizeResult(result: NonNullable<TavilyResponse['results']>[number]): SearchResult | null {
  if (typeof result.title !== 'string' || typeof result.url !== 'string') return null;
  return {
    title: result.title,
    url: result.url,
    ...(typeof result.content === 'string' ? { snippet: result.content } : {}),
    ...(typeof result.published_date === 'string' ? { publishedAt: result.published_date } : {}),
  };
}
