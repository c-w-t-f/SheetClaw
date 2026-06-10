import { describe, expect, it, vi } from 'vitest';
import { filterToolsForRun } from '../../agent/tool-filter';
import type { ToolSpec } from '../../types';
import { createWebSearchHandler, WEB_SEARCH } from '../search';
import { tavilyProvider } from '../providers/tavily';
import { ToolExecutor } from '../../workbook/executor';
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
    const fetchImpl = vi.fn(async () => jsonResponse({ results: DOMAIN_FIXTURES }));

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
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));

    const results = await tavilyProvider.search('no matches', {
      maxResults: 3,
      apiKey: 'key',
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(results).toEqual([]);
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
