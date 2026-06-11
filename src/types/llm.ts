import type { ToolSpec } from './tool';
import type { NativeSearchCapability } from '../adapters/native-search';

// ── Normalized wire format between adapters and AgentLoop ──────────────────

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type NormalizedMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: NormalizedToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

// ── LLMRequest ─────────────────────────────────────────────────────────────

export interface LLMRequest {
  model: string;
  messages: NormalizedMessage[];
  tools: ToolSpec[];
  nativeSearch?: NativeSearchCapability;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

// ── Streamed event union ───────────────────────────────────────────────────

export type LLMStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call-start'; index: number; id: string; name: string }
  | { type: 'tool-call-delta'; index: number; argumentsDelta: string }
  | { type: 'tool-call-end'; index: number }
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      cacheRead?: number;
      cacheWrite?: number;
      source: 'provider' | 'estimated';
    }
  | { type: 'done'; finishReason: 'stop' | 'tool_calls' | 'length' | 'error' }
  | { type: 'error'; error: LLMError };

// ── Error types ────────────────────────────────────────────────────────────

export type LLMError =
  | { code: 'AuthError'; message: string }
  | { code: 'RateLimitError'; message: string; retryAfter?: number }
  | { code: 'NetworkError'; message: string }
  | { code: 'ProviderError'; message: string; status: number; body?: unknown }
  | { code: 'MalformedResponseError'; message: string }
  | { code: 'NotSupported'; message: string };

// ── LLMClient interface ────────────────────────────────────────────────────

export interface LLMClient {
  chat(req: LLMRequest, signal: AbortSignal): AsyncIterable<LLMStreamEvent>;
  listModels(): Promise<import('./provider').ModelInfo[]>;
  capabilities(): import('./provider').ProviderCapabilities;
}
