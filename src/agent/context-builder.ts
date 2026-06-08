import type {
  LLMRequest,
  NormalizedMessage,
  NormalizedToolCall,
  ToolSpec,
  Message,
  AgentSession,
  ProviderConfig,
} from '../types';
import type { WorkbookRegistry } from '../workbook/registry';
import { buildSystemPrompt } from './system-prompt';

// ── Token estimation ───────────────────────────────────────────────────────
// Rough character-to-token ratio; good enough for budget decisions.
const CHARS_PER_TOKEN = 4;
const MAX_TOOL_RESULT_CHARS = 2000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ── Message conversion ─────────────────────────────────────────────────────

function toNormalized(messages: Message[]): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const m of messages) {
    switch (m.role) {
      case 'user':
        out.push({ role: 'user', content: m.text });
        break;
      case 'assistant': {
        const toolCalls: NormalizedToolCall[] = (m.toolCalls ?? []).map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        }));
        out.push({ role: 'assistant', content: m.text, toolCalls: toolCalls.length ? toolCalls : undefined });
        break;
      }
      case 'tool': {
        const payload = m.result.ok
          ? JSON.stringify(m.result.data)
          : JSON.stringify(m.result.error);
        // Truncate large payloads to protect context budget
        const truncated = payload.length > MAX_TOOL_RESULT_CHARS
          ? payload.slice(0, MAX_TOOL_RESULT_CHARS) + `… (${payload.length - MAX_TOOL_RESULT_CHARS} chars truncated)`
          : payload;
        out.push({ role: 'tool', toolCallId: m.toolCallId, name: m.result.toolCallId, content: truncated });
        break;
      }
      // ToolCallMessage, ConfirmationMessage, SystemNoticeMessage are UI-only — skip
    }
  }
  return out;
}

// ── Compaction ─────────────────────────────────────────────────────────────

function compact(
  history: NormalizedMessage[],
  fixedTokens: number,  // system + manifest
  budget: number,
  maxOutput: number
): NormalizedMessage[] {
  const available = budget - fixedTokens - maxOutput;
  if (available <= 0) return history.slice(-2); // emergency floor

  const histStr = JSON.stringify(history);
  if (estimateTokens(histStr) <= available) return history;

  // Step 1: truncate tool result payloads further (to 200 chars)
  const step1 = history.map(m => {
    if (m.role === 'tool' && m.content.length > 200) {
      return { ...m, content: m.content.slice(0, 200) + '…[truncated]' };
    }
    return m;
  });
  if (estimateTokens(JSON.stringify(step1)) <= available) return step1;

  // Steps 2-3: drop oldest pairs, always keep first user message + last 4 messages
  const firstUser = step1.findIndex(m => m.role === 'user');
  const kept = firstUser >= 0 ? [step1[firstUser]] : [];
  let tail = step1.slice(firstUser + 1);

  while (tail.length > 4 && estimateTokens(JSON.stringify([...kept, ...tail])) > available) {
    // Drop the oldest user+assistant pair (skip tool results attached to it)
    const firstUserInTail = tail.findIndex(m => m.role === 'user');
    if (firstUserInTail < 0) { tail = tail.slice(2); break; }
    // Drop from firstUserInTail through the next user message
    const nextUser = tail.findIndex((m, i) => i > firstUserInTail && m.role === 'user');
    tail = nextUser < 0 ? tail.slice(-4) : tail.slice(nextUser);
  }
  return [...kept, ...tail];
}

// ── ContextBuilder ─────────────────────────────────────────────────────────

export class ContextBuilder {
  constructor(private registry: WorkbookRegistry) {}

  build(
    session: AgentSession,
    messages: Message[],
    tools: ToolSpec[],
    cfg: ProviderConfig
  ): LLMRequest {
    const system = buildSystemPrompt(session.scope.workbookId);
    const manifest = this.registry.getManifest();
    const manifestStr = `\n\n<workbook_manifest>\n${JSON.stringify(manifest, null, 2)}\n</workbook_manifest>`;

    const budget = cfg.contextLimits.maxContextTokens;
    const maxOutput = cfg.maxOutputTokens ?? 4096;
    const fixedTokens = estimateTokens(system + manifestStr + JSON.stringify(tools));

    const rawHistory = toNormalized(messages);
    const history = compact(rawHistory, fixedTokens, budget, maxOutput);

    // Prepend manifest as a system-level note in the first user message slot
    const firstUser = history.findIndex(m => m.role === 'user');
    const withManifest: NormalizedMessage[] =
      firstUser >= 0
        ? [
            ...history.slice(0, firstUser),
            { role: 'user', content: history[firstUser].content + manifestStr },
            ...history.slice(firstUser + 1),
          ]
        : history;

    return {
      model: cfg.model,
      messages: withManifest,
      tools,
      system,
      temperature: cfg.temperature,
      maxTokens: maxOutput,
    };
  }

  estimateInputTokens(
    session: AgentSession,
    messages: Message[],
    tools: ToolSpec[],
    cfg: ProviderConfig
  ): number {
    const req = this.build(session, messages, tools, cfg);
    return estimateTokens(
      (req.system ?? '') +
      JSON.stringify(req.messages) +
      JSON.stringify(req.tools)
    );
  }
}
