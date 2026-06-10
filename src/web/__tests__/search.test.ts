import { describe, expect, it, vi } from 'vitest';
import { filterToolsForRun } from '../../agent/tool-filter';
import type { ToolSpec } from '../../types';
import { createWebSearchHandler, WEB_SEARCH } from '../search';
import { tavilyProvider } from '../providers/tavily';
import { googleCseProvider } from '../providers/google-cse';
import { jinaProvider } from '../providers/jina';
import { searxngProvider } from '../providers/searxng';
import { wikipediaProvider } from '../providers/wikipedia';
import { ToolExecutor, ToolValidationError } from '../../workbook/executor';
import { WorkbookRegistry } from '../../workbook/registry';
import type { ToolCall } from '../../types';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DOMAIN_FIXTURES = [
  {
    title: 'Quarterly filing',
    url: 'https://finance.example/reports/q1',
    content: 'Revenue table and notes.',
  },
  {
    title: 'Hourly forecast',
    url: 'https://weather.example/api/hourly',
    content: 'Temperature and precipitation fields.',
  },
  {
    title: 'Match schedule',
    url: 'https://sports.example/schedule',
    content: 'Fixtures and scores.',
  },
];

describe('Tavily adapter', () => {
  it('parses documented JSON results from unrelated domains', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ results: DOMAIN_FIXTURES }));

    const results = await tavilyProvider.search('public data', {
      maxResults: 3,
      apiKey: 'key',
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(results).toEqual([
      { title: 'Quarterly filing', url: 'https://finance.example/reports/q1', snippet: 'Revenue table and notes.' },
      { title: 'Hourly forecast', url: 'https://weather.example/api/hourly', snippet: 'Temperature and precipitation fields.' },
      { title: 'Match schedule', url: 'https://sports.example/schedule', snippet: 'Fixtures and scores.' },
    ]);
  });

  it('preserves zero results as an empty array', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ results: [] }));

    const results = await tavilyProvider.search('no matches', {
      maxResults: 3,
      apiKey: 'key',
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(results).toEqual([]);
  });
});

describe('Google CSE adapter', () => {
  it('parses documented items, sends the key as a header, and caps num at 10', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      items: DOMAIN_FIXTURES.map(f => ({ title: f.title, link: f.url, snippet: f.content })),
    }));

    const results = await googleCseProvider.search('public data', {
      maxResults: 10,
      apiKey: 'gkey',
      engineId: 'engine123',
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: 'Quarterly filing',
      url: 'https://finance.example/reports/q1',
      snippet: 'Revenue table and notes.',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('cx=engine123');
    expect(String(url)).toContain('num=10');
    expect(String(url)).not.toContain('gkey');
    expect((init as RequestInit).headers).toMatchObject({ 'X-Goog-Api-Key': 'gkey' });
  });

  it('requires an engine id before issuing a request', async () => {
    const fetchImpl = vi.fn();
    await expect(googleCseProvider.search('public data', {
      maxResults: 5,
      apiKey: 'gkey',
      signal: new AbortController().signal,
      fetchImpl,
    })).rejects.toBeInstanceOf(ToolValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Jina adapter', () => {
  it('parses documented data items and authenticates with a bearer header', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      data: DOMAIN_FIXTURES.map(f => ({ title: f.title, url: f.url, description: f.content })),
    }));

    const results = await jinaProvider.search('public data', {
      maxResults: 3,
      apiKey: 'jkey',
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(results.map(r => r.url)).toEqual(DOMAIN_FIXTURES.map(f => f.url));
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ 'Authorization': 'Bearer jkey' });
  });
});

describe('SearXNG adapter', () => {
  it('parses documented results keylessly from a user-supplied instance URL', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      results: DOMAIN_FIXTURES.map(f => ({ title: f.title, url: f.url, content: f.content })),
    }));

    const results = await searxngProvider.search('public data', {
      maxResults: 3,
      apiKey: '',
      baseUrl: 'http://localhost:8888/search',
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(results).toHaveLength(3);
    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('http://localhost:8888/search');
    expect(String(url)).toContain('format=json');
  });
});

describe('Wikipedia adapter', () => {
  it('parses documented search hits keylessly, building article URLs and stripping snippet HTML', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      query: {
        search: [
          { title: 'Compound interest', snippet: 'the addition of <span class="searchmatch">interest</span> to principal' },
          { title: 'Gross domestic product', snippet: 'monetary measure of market value' },
        ],
      },
    }));

    const results = await wikipediaProvider.search('public data', {
      maxResults: 2,
      apiKey: '',
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(results).toEqual([
      {
        title: 'Compound interest',
        url: 'https://en.wikipedia.org/wiki/Compound_interest',
        snippet: 'the addition of interest to principal',
      },
      {
        title: 'Gross domestic product',
        url: 'https://en.wikipedia.org/wiki/Gross_domestic_product',
        snippet: 'monetary measure of market value',
      },
    ]);
    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('origin=*');
  });
});

describe('web_search handler', () => {
  it('returns NetworkError through the executor path without fabricated result URLs', async () => {
    const executor = new ToolExecutor(new WorkbookRegistry(), async () => {
      throw new Error('runtime none should not use Excel runner');
    });
    executor.register(WEB_SEARCH, createWebSearchHandler({
      getProvider: () => 'tavily',
      getApiKey: () => 'key',
      fetchImpl: vi.fn(async () => { throw new TypeError('network down'); }),
    }));

    const call: ToolCall = {
      id: 'search_call',
      name: 'web_search',
      arguments: { query: 'anything' },
      workbookId: 'host',
      mutating: false,
    };
    const result = await executor.execute(call, { workbookId: 'host' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NetworkError');
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\//);
  });
});

describe('web tool exposure gating', () => {
  const tools: ToolSpec[] = [
    { name: 'read_range', description: '', parameters: { type: 'object', properties: {} }, mutating: false },
    WEB_SEARCH,
    { name: 'fetch_url', description: '', parameters: { type: 'object', properties: {} }, mutating: false, runtime: 'none' },
  ];

  it('toggle off removes web tools from the LLM request', () => {
    expect(filterToolsForRun(tools, false, true).map(t => t.name)).toEqual(['read_range']);
  });

  it('missing provider key removes web tools even if toggle is on', () => {
    expect(filterToolsForRun(tools, true, false).map(t => t.name)).toEqual(['read_range']);
  });

  it('configured provider and toggle on exposes both web tools', () => {
    expect(filterToolsForRun(tools, true, true).map(t => t.name)).toEqual(['read_range', 'web_search', 'fetch_url']);
  });
});
