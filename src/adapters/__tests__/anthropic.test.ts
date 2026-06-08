import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from '../anthropic';
import { parseLenientToolCall } from '../ollama';
import type { LLMStreamEvent, ToolSpec } from '../../types';

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

describe('Anthropic adapter — HTTP error handling', () => {
  it('emits AuthError on 401', async () => {
    globalThis.fetch = async () =>
      new Response('{"error":{"type":"authentication_error","message":"invalid x-api-key"}}', { status: 401 });
    const events = await collect(adapter);
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'AuthError' } });
  });
});

// ── Ollama lenient parser ──────────────────────────────────────────────────

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
