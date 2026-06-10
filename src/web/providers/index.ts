import { tavilyProvider } from './tavily';

export type SearchProviderId = 'tavily';
export type WebAccessProvider = 'none' | SearchProviderId;

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
}

export interface SearchProviderAdapter {
  id: SearchProviderId;
  label: string;
  requiresKey: boolean;
  endpoint: string;
  signupUrl: string;
  search(
    query: string,
    opts: { maxResults: number; apiKey: string; baseUrl?: string; signal: AbortSignal; fetchImpl?: typeof fetch }
  ): Promise<SearchResult[]>;
}

export const SEARCH_PROVIDERS: Record<SearchProviderId, SearchProviderAdapter> = {
  tavily: tavilyProvider,
};

export const PROVIDER_HOST_ALLOWLIST = Object.values(SEARCH_PROVIDERS).map(provider => {
  const url = new URL(provider.endpoint);
  return url.hostname;
});

export function getSearchProvider(id: WebAccessProvider): SearchProviderAdapter | null {
  if (id === 'none') return null;
  return SEARCH_PROVIDERS[id] ?? null;
}
