import type {
  LLMClient,
  LLMRequest,
  LLMStreamEvent,
  LLMError,
  NormalizedMessage,
  ToolSpec,
  ModelInfo,
  ProviderCapabilities,
  ProviderKey,
} from '../types';
import { getAnthropicNativeSearchTool } from './native-search';

export interface AnthropicAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  provider?: ProviderKey;
}

const DEFAULT_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

// ── Wire types (Anthropic SSE) ─────────────────────────────────────────────

type AnthropicEvent =
  | { type: 'message_start'; message: { usage: { input_tokens: number } } }
  | { type: 'content_block_start'; index: number; content_block: { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string }; usage: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } }
  | { type: 'ping' };

// ── Serialization ──────────────────────────────────────────────────────────

function serializeTools(tools: ToolSpec[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: t.parameters.type,
      properties: t.parameters.properties,
      required: t.parameters.required,
    },
  }));
}

function serializeMessages(messages: NormalizedMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // system goes top-level
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const content: unknown[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
      }
      out.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      // Tool results must be batched into a single user message with the preceding assistant turn
      // Find if the previous pushed item is a user message with tool_result content
      const prev = out[out.length - 1] as { role: string; content: unknown[] } | undefined;
      const toolResultBlock = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      if (prev?.role === 'user' && Array.isArray(prev.content) &&
          (prev.content[0] as { type?: string })?.type === 'tool_result') {
        prev.content.push(toolResultBlock);
      } else {
        out.push({ role: 'user', content: [toolResultBlock] });
      }
    }
  }
  return out;
}

// ── SSE parser (Anthropic uses event: + data: pairs; we key on data: type field) ───

async function* parseAnthropicSSE(body: ReadableStream<Uint8Array>): AsyncIterable<AnthropicEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          yield JSON.parse(raw) as AnthropicEvent;
        } catch { /* skip malformed */ }
      }
    }
    if (buf.startsWith('data: ')) {
      const raw = buf.slice(6).trim();
      if (raw && raw !== '[DONE]') {
        try { yield JSON.parse(raw) as AnthropicEvent; } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Error mapping ──────────────────────────────────────────────────────────

async function mapHttpError(res: Response): Promise<LLMError> {
  let body: unknown;
  try { body = await res.json(); } catch { body = await res.text(); }
  if (res.status === 401) return { code: 'AuthError', message: 'Invalid API key (401)' };
  if (res.status === 429) return { code: 'RateLimitError', message: 'Rate limited (429)' };
  if (res.status === 529) return { code: 'RateLimitError', message: 'Anthropic overloaded (529)' };
  return { code: 'ProviderError', message: `HTTP ${res.status}`, status: res.status, body };
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class AnthropicAdapter implements LLMClient {
  private base: string;
  constructor(private cfg: AnthropicAdapterConfig) {
    this.base = cfg.baseUrl ?? DEFAULT_BASE;
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsOAuth: false,
      nativeUsage: true,
      toolFormat: 'anthropic',
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic has no public /models endpoint — return known set
    return [
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', supportsTools: true },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', supportsTools: true },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', supportsTools: true },
    ];
  }

  async *chat(req: LLMRequest, signal: AbortSignal): AsyncIterable<LLMStreamEvent> {
    const system = req.system ?? req.messages.find(m => m.role === 'system')?.content;
    const userMessages = req.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      messages: serializeMessages(userMessages),
    };
    if (system) body.system = system;
    const nativeTool = getAnthropicNativeSearchTool(this.cfg.provider, req.nativeSearch);
    if (req.tools.length || nativeTool) body.tools = [
      ...serializeTools(req.tools),
      ...(nativeTool ? [nativeTool] : []),
    ];
    if (req.temperature !== undefined) body.temperature = req.temperature;

    let res: Response;
    try {
      res = await fetch(`${this.base}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.cfg.apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      yield { type: 'error', error: { code: 'NetworkError', message: String(e) } };
      return;
    }

    if (!res.ok) {
      yield { type: 'error', error: await mapHttpError(res) };
      return;
    }
    if (!res.body) {
      yield { type: 'error', error: { code: 'MalformedResponseError', message: 'Empty response body' } };
      return;
    }

    // Index-keyed accumulators
    const toolAccum: Record<number, { id: string; name: string; argsBuf: string }> = {};
    let inputTokens = 0;

    try {
      for await (const ev of parseAnthropicSSE(res.body)) {
        if (signal.aborted) return;

        switch (ev.type) {
          case 'message_start':
            inputTokens = ev.message.usage.input_tokens;
            break;

          case 'content_block_start': {
            const cb = ev.content_block;
            if (cb.type === 'tool_use') {
              toolAccum[ev.index] = { id: cb.id, name: cb.name, argsBuf: '' };
              yield { type: 'tool-call-start', index: ev.index, id: cb.id, name: cb.name };
            }
            break;
          }

          case 'content_block_delta': {
            const d = ev.delta;
            if (d.type === 'text_delta') {
              yield { type: 'text-delta', delta: d.text };
            } else if (d.type === 'input_json_delta') {
              const acc = toolAccum[ev.index];
              if (acc) {
                acc.argsBuf += d.partial_json;
                yield { type: 'tool-call-delta', index: ev.index, argumentsDelta: d.partial_json };
              }
            }
            break;
          }

          case 'content_block_stop':
            if (toolAccum[ev.index]) {
              yield { type: 'tool-call-end', index: ev.index };
            }
            break;

          case 'message_delta': {
            const outputTokens = ev.usage.output_tokens;
            yield {
              type: 'usage',
              inputTokens,
              outputTokens,
              source: 'provider',
            };
            const reason = ev.delta.stop_reason;
            const finishReason =
              reason === 'tool_use' ? 'tool_calls' :
              reason === 'max_tokens' ? 'length' : 'stop';
            yield { type: 'done', finishReason };
            break;
          }

          case 'error':
            yield {
              type: 'error',
              error: { code: 'ProviderError', message: ev.error.message, status: 0 },
            };
            return;
        }
      }
    } catch (e) {
      if (signal.aborted) return;
      yield { type: 'error', error: { code: 'NetworkError', message: String(e) } };
    }
  }
}
