import type { LLMClient, LLMStreamEvent, ToolSpec, NormalizedMessage } from '../types';

// ── Canary tool ────────────────────────────────────────────────────────────
// A simple echo tool that every tool-capable model should call when asked.

export const CANARY_TOOL: ToolSpec = {
  name: 'harness_echo',
  description: 'Echo a value back to the caller. Call this when asked to echo.',
  parameters: {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'The value to echo' },
    },
    required: ['value'],
  },
  mutating: false,
};

export const CANARY_PROMPT =
  'Call the harness_echo tool with value "ping". Do not say anything else.';

// ── Result types ───────────────────────────────────────────────────────────

export interface HarnessRawEvent {
  type: 'raw';
  event: LLMStreamEvent;
}
export interface HarnessResult {
  type: 'result';
  pass: boolean;
  message: string;
  toolCallName?: string;
  toolCallArgs?: Record<string, unknown>;
}
export type HarnessEvent = HarnessRawEvent | HarnessResult;

// ── Runner ─────────────────────────────────────────────────────────────────

export async function* runHarness(
  client: LLMClient,
  model: string,
  signal: AbortSignal
): AsyncGenerator<HarnessEvent> {
  const messages: NormalizedMessage[] = [
    { role: 'user', content: CANARY_PROMPT },
  ];

  let toolCallName: string | undefined;
  let argsBuf = '';
  let hadError = false;
  let errMsg = '';

  for await (const ev of client.chat({ model, messages, tools: [CANARY_TOOL] }, signal)) {
    yield { type: 'raw', event: ev };

    switch (ev.type) {
      case 'tool-call-start':
        toolCallName = ev.name;
        argsBuf = '';
        break;
      case 'tool-call-delta':
        argsBuf += ev.argumentsDelta;
        break;
      case 'error':
        hadError = true;
        errMsg = `${ev.error.code}: ${ev.error.message}`;
        break;
    }
  }

  if (hadError) {
    yield { type: 'result', pass: false, message: `Error from provider — ${errMsg}` };
    return;
  }

  if (!toolCallName) {
    yield { type: 'result', pass: false, message: 'No tool call emitted — model does not support tools or ignored the prompt' };
    return;
  }

  if (toolCallName !== 'harness_echo') {
    yield { type: 'result', pass: false, message: `Wrong tool called: "${toolCallName}" (expected "harness_echo")` };
    return;
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsBuf) as Record<string, unknown>;
  } catch {
    yield { type: 'result', pass: false, message: `Tool arguments are not valid JSON: ${argsBuf}` };
    return;
  }

  if (typeof args.value !== 'string') {
    yield { type: 'result', pass: false, message: `Missing "value" field in tool arguments: ${JSON.stringify(args)}` };
    return;
  }

  yield {
    type: 'result',
    pass: true,
    message: `PASS — tool call well-formed; value="${args.value}"`,
    toolCallName,
    toolCallArgs: args,
  };
}
