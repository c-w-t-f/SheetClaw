import { ToolNetworkError } from '../../workbook/executor';
import type { SearchProviderAdapter, SearchResult } from './index';

interface WikipediaResponse {
  query?: {
    search?: Array<{
      title?: unknown;
      snippet?: unknown;
    }>;
  };
}

export const wikipediaProvider: SearchProviderAdapter = {
  id: 'wikipedia',
  label: 'Wikipedia (keyless, encyclopedic only)',
  requiresKey: false,
  endpoint: 'https://en.wikipedia.org/w/api.php',
  signupUrl: 'https://www.mediawiki.org/wiki/API:Search',

  async search(query, opts): Promise<SearchResult[]> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const url = new URL(opts.baseUrl ?? this.endpoint);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    url.searchParams.set('srlimit', String(Math.min(opts.maxResults, 10)));
    url.searchParams.set('srsearch', query);

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        signal: opts.signal,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new ToolNetworkError(`wikipedia request failed: ${message}`);
    }

    if (!response.ok) {
      throw new ToolNetworkError(`wikipedia request failed with HTTP ${response.status}`);
    }

    let json: WikipediaResponse;
    try {
      json = await response.json() as WikipediaResponse;
    } catch {
      throw new ToolNetworkError('wikipedia response was not valid JSON');
    }

    const articleBase = new URL(opts.baseUrl ?? this.endpoint).origin;
    return (json.query?.search ?? [])
      .map(item => normalizeResult(item, articleBase))
      .filter((result): result is SearchResult => !!result);
  },
};

function normalizeResult(
  item: NonNullable<NonNullable<WikipediaResponse['query']>['search']>[number],
  articleBase: string
): SearchResult | null {
  if (typeof item.title !== 'string' || !item.title) return null;
  return {
    title: item.title,
    url: `${articleBase}/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
    ...(typeof item.snippet === 'string' ? { snippet: stripHtml(item.snippet) } : {}),
  };
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
