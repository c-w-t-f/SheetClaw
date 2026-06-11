import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from '../anthropic';
import { getNativeSearchCapability } from '../native-search';
import { parseLenientToolCall } from '../ollama';
import type { LLMRequest, LLMStreamEvent, ToolSpec } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────

function sseLines(events: object[]): string {
  return events
    .map(e => `data: ${JSON.stringify(e)}\n`)
    .join('\n') + '\n';
}

function makeStream(lines: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); },
  });
}

function mockFetch(lines: string, status = 200) {
  globalThis.fetch = async () =>
    new Response(makeStream(lines), { status, headers: { 'Content-Type': 'text/event-stream' } });
}

async function collect(adapter: AnthropicAdapter): Promise<LLMStreamEvent[]> {
  const events: LLMStreamEvent[] = [];
  for await (const ev of adapter.chat(
    { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], tools: [] },
    new AbortController().signal
  )) events.push(ev);
  return events;
}

async function captureRequestBody(
  adapter: AnthropicAdapter,
  req: LLMRequest
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(makeStream(sseLines([
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ])), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  for await (const _ev of adapter.chat(req, new AbortController().signal)) {
    // Drain the stream so fetch runs.
  }
  if (!body) throw new Error('request body was not captured');
  return body;
}

const adapter = new AnthropicAdapter({ apiKey: 'test' });

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Anthropic adapter — text streaming', () => {
  it('emits text-delta events, usage, and done', async () => {
    mockFetch(sseLines([
      { type: 'message_start', message: { usage: { input_tokens: 12 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
      { type: 'message_stop' },
    ]));

    const events = await collect(adapter);
    const deltas = events.filter(e => e.type === 'text-delta');
    expect(deltas).toHaveLength(2);
    expect((deltas[0] as { delta: string }).delta).toBe('Hello');

    expect(events.find(e => e.type === 'usage')).toMatchObject({
      type: 'usage', inputTokens: 12, outputTokens: 8, source: 'provider',
    });
    expect(events.find(e => e.type === 'done')).toMatchObject({ type: 'done', finishReason: 'stop' });
  });
});

describe('Anthropic adapter — tool_use block with fragmented input_json', () => {
  it('emits tool-call-start / deltas / end and maps stop_reason:tool_use → tool_calls', async () => {
    mockFetch(sseLines([
      { type: 'message_start', message: { usage: { input_tokens: 40 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_01', name: 'read_range' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"workbook_id"' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':"wb1","sheet":"S1","address":"A1"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 22 } },
      { type: 'message_stop' },
    ]));

    const events = await collect(adapter);

    expect(events.find(e => e.type === 'tool-call-start')).toMatchObject({
      type: 'tool-call-start', index: 0, id: 'toolu_01', name: 'read_range',
    });

    const deltas = events.filter(e => e.type === 'tool-call-delta');
    expect(deltas).toHaveLength(2);
    const reassembled = deltas
      .map(e => (e as { argumentsDelta: string }).argumentsDelta)
      .join('');
    expect(JSON.parse(reassembled)).toEqual({ workbook_id: 'wb1', sheet: 'S1', address: 'A1' });

    expect(events.find(e => e.type === 'tool-call-end')).toMatchObject({ index: 0 });
    expect(events.find(e => e.type === 'done')).toMatchObject({ finishReason: 'tool_calls' });
  });
});

describe('Anthropic adapter — OpenAI normalization conformance', () => {
  it('produces the same LLMStreamEvent shape as the OpenAI adapter for a tool call', async () => {
    mockFetch(sseLines([
      { type: 'message_start', message: { usage: { input_tokens: 30 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_02', name: 'list_sheets' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"workbook_id":"wb1"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } },
      { type: 'message_stop' },
    ]));
    const events = await collect(adapter);

    // Same event types as OpenAI adapter emits — shapes must be identical
    expect(events.find(e => e.type === 'tool-call-start')).toHaveProperty('id');
    expect(events.find(e => e.type === 'tool-call-start')).toHaveProperty('name');
    expect(events.find(e => e.type === 'tool-call-start')).toHaveProperty('index');
    expect(events.find(e => e.type === 'tool-call-delta')).toHaveProperty('argumentsDelta');
    expect(events.find(e => e.type === 'tool-call-end')).toHaveProperty('index');
    expect(events.find(e => e.type === 'usage')).toHaveProperty('inputTokens');
    expect(events.find(e => e.type === 'usage')).toHaveProperty('outputTokens');
    expect(events.find(e => e.type === 'usage')).toHaveProperty('source');
    expect(events.find(e => e.type === 'done')).toHaveProperty('finishReason');
  });
});

describe('Anthropic adapter - native search stream tolerance', () => {
  it('skips server search blocks without corrupting text or client tool calls', async () => {
    mockFetch(sseLines([
      { type: 'message_start', message: { id: 'msg_1', type: 'message' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will check that.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"latest data"}' } },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_1',
          content: [{ type: 'web_search_result', title: 'Result', url: 'https://public.example' }],
        },
      },
      { type: 'content_block_stop', index: 2 },
      { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'toolu_read', name: 'read_range' } },
      { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"sheet":"Sheet1"' } },
      { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: ',"address":"A1"}' } },
      { type: 'content_block_stop', index: 3 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: {
          output_tokens: 12,
          server_tool_use: { web_search_requests: 1 },
        },
      },
      { type: 'message_stop' },
    ]));

    const events = await collect(adapter);

    expect(events.filter(e => e.type === 'error')).toHaveLength(0);
    expect(events.filter(e => e.type === 'text-delta')).toEqual([
      { type: 'text-delta', delta: 'I will check that.' },
    ]);
    expect(events.filter(e => e.type === 'tool-call-start')).toEqual([
      { type: 'tool-call-start', index: 3, id: 'toolu_read', name: 'read_range' },
    ]);

    const args = events
      .filter(e => e.type === 'tool-call-delta')
      .map(e => (e as { argumentsDelta: string }).argumentsDelta)
      .join('');
    expect(JSON.parse(args)).toEqual({ sheet: 'Sheet1', address: 'A1' });
    expect(events.find(e => e.type === 'usage')).toMatchObject({ inputTokens: 0, outputTokens: 12 });
    expect(events.find(e => e.type === 'done')).toMatchObject({ finishReason: 'tool_calls' });
  });
});

describe('Anthropic adapter — HTTP error handling', () => {
  it('emits AuthError on 401', async () => {
    globalThis.fetch = async () =>
      new Response('{"error":{"type":"authentication_error","message":"invalid x-api-key"}}', { status: 401 });
    const events = await collect(adapter);
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'AuthError' } });
  });
});

// ── Ollama lenient parser ──────────────────────────────────────────────────

describe('Anthropic adapter - native search request mutations', () => {
  const readRange: ToolSpec = {
    name: 'read_range',
    description: 'Read a range',
    parameters: { type: 'object', properties: {}, required: [] },
    mutating: false,
  };

  it('adds the Anthropic web search server tool only for the anthropic provider', async () => {
    const body = await captureRequestBody(
      new AnthropicAdapter({ apiKey: 'test', provider: 'anthropic' }),
      {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [readRange],
        nativeSearch: getNativeSearchCapability('anthropic', 'claude-sonnet-4-6'),
      }
    );

    expect(body.tools).toEqual([
      expect.objectContaining({ name: 'read_range' }),
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    ]);
  });

  it('does not send the Anthropic mutation when the request capability belongs to another provider', async () => {
    const body = await captureRequestBody(
      new AnthropicAdapter({ apiKey: 'test', provider: 'anthropic' }),
      {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [readRange],
        nativeSearch: getNativeSearchCapability('generic', 'openai/gpt-4o-mini'),
      }
    );

    expect(body.tools).toEqual([expect.objectContaining({ name: 'read_range' })]);
    expect(JSON.stringify(body)).not.toContain('web_search_20250305');
  });
});

const TOOLS: ToolSpec[] = [{
  name: 'read_range',
  description: 'Read a range',
  parameters: { type: 'object', properties: { workbook_id: { type: 'string' }, sheet: { type: 'string' } }, required: ['workbook_id', 'sheet'] },
  mutating: false,
}];

describe('Ollama lenient tool-call parser', () => {
  it('extracts a tool call from fenced JSON', () => {
    const text = 'I will read the range:\n```json\n{"name":"read_range","workbook_id":"wb1","sheet":"Sheet1"}\n```';
    const result = parseLenientToolCall(text, TOOLS);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('read_range');
    expect(result?.arguments).toMatchObject({ workbook_id: 'wb1', sheet: 'Sheet1' });
  });

  it('extracts a tool call from bare JSON', () => {
    const text = 'Sure: {"name":"read_range","workbook_id":"wb2","sheet":"S2"}';
    const result = parseLenientToolCall(text, TOOLS);
    expect(result?.name).toBe('read_range');
  });

  it('returns null for text with no matching tool name', () => {
    const text = '```json\n{"name":"unknown_tool","foo":"bar"}\n```';
    expect(parseLenientToolCall(text, TOOLS)).toBeNull();
  });

  it('returns null for plain text with no JSON', () => {
    expect(parseLenientToolCall('Hello, how can I help?', TOOLS)).toBeNull();
  });
});
