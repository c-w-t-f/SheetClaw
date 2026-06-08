import { describe, it, expect, beforeEach } from 'vitest';
import { AgentLoop } from '../loop';
import { WorkbookRegistry } from '../../workbook/registry';
import { SnapshotManager } from '../../workbook/snapshot';
import { useStore } from '../../store/index';
import type { LLMClient, LLMStreamEvent, LLMRequest, ProviderConfig } from '../../types';
import type { ToolSpec, ToolResult } from '../../types';
import type { ToolExecutor } from '../../workbook/executor';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRegistry(wbId = 'wb1'): WorkbookRegistry {
  const r = new WorkbookRegistry();
  (r as unknown as { handles: Map<string, unknown>; activeId: string; hostId: string }).handles.set(wbId, {
    workbookId: wbId, name: 'Test.xlsx', isActive: true, isHost: true,
    sheets: [{ name: 'Sheet1', position: 0, visible: true }],
    lastRefreshed: new Date().toISOString(), capability: 'host-only',
  });
  (r as unknown as { activeId: string; hostId: string }).activeId = wbId;
  (r as unknown as { hostId: string }).hostId = wbId;
  return r;
}

function makeExecutor(specs: ToolSpec[] = [], execResult?: ToolResult): Partial<ToolExecutor> {
  return {
    getToolSpecs: () => specs,
    execute: async (call) => execResult ?? { toolCallId: call.id, ok: true, data: { result: 'ok' } },
  };
}

async function* textStream(text: string): AsyncIterable<LLMStreamEvent> {
  yield { type: 'text-delta', delta: text };
  yield { type: 'usage', inputTokens: 10, outputTokens: 5, source: 'estimated' };
  yield { type: 'done', finishReason: 'stop' };
}

async function* toolCallStream(toolId: string, toolName: string, args: string): AsyncIterable<LLMStreamEvent> {
  yield { type: 'tool-call-start', index: 0, id: toolId, name: toolName };
  yield { type: 'tool-call-delta', index: 0, argumentsDelta: args };
  yield { type: 'tool-call-end', index: 0 };
  yield { type: 'usage', inputTokens: 20, outputTokens: 8, source: 'estimated' };
  yield { type: 'done', finishReason: 'tool_calls' };
}

function makeSingleTurnClient(events: AsyncIterable<LLMStreamEvent>): LLMClient {
  return {
    chat: () => events,
    listModels: async () => [],
    capabilities: () => ({ supportsTools: true, supportsStreaming: true, supportsOAuth: false, nativeUsage: false, toolFormat: 'openai' as const }),
  };
}

function makeTwoTurnClient(
  firstEvents: AsyncIterable<LLMStreamEvent>,
  secondEvents: AsyncIterable<LLMStreamEvent>
): LLMClient {
  let call = 0;
  return {
    chat: (_req: LLMRequest) => {
      call++;
      return call === 1 ? firstEvents : secondEvents;
    },
    listModels: async () => [],
    capabilities: () => ({ supportsTools: true, supportsStreaming: true, supportsOAuth: false, nativeUsage: false, toolFormat: 'openai' as const }),
  };
}

const CFG: ProviderConfig = {
  provider: 'ollama', enabled: true,
  baseUrl: 'http://localhost:11434', model: 'llama3.2',
  authMode: 'none', authStateRef: '',
  contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  maxOutputTokens: 4096,
};

const SCOPE = { workbookId: 'wb1' };

function noop<T>(fn: (ctx: Excel.RequestContext) => Promise<T>): Promise<T> {
  return fn({} as Excel.RequestContext);
}

// ── Reset store between tests ──────────────────────────────────────────────

beforeEach(() => {
  useStore.getState().setSession(null);
  useStore.getState().clearMessages();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AgentLoop — text-only run', () => {
  it('creates session, appends user + assistant message, ends with status done', async () => {
    const loop = new AgentLoop(
      makeRegistry(),
      makeExecutor() as unknown as ToolExecutor,
      new SnapshotManager(),
      noop
    );

    const client = makeSingleTurnClient(textStream('Hello from LLM!'));
    await loop.start('Say hi', SCOPE, client, CFG);

    const state = useStore.getState();
    expect(state.currentSession?.status).toBe('done');

    const msgs = state.messages;
    const userMsg = msgs.find(m => m.role === 'user');
    const assistantMsg = msgs.find(m => m.role === 'assistant');

    expect(userMsg).toBeDefined();
    expect((userMsg as { text: string }).text).toBe('Say hi');
    expect(assistantMsg).toBeDefined();
    expect((assistantMsg as { text: string }).text).toBe('Hello from LLM!');
  });

  it('accumulates token totals', async () => {
    const loop = new AgentLoop(
      makeRegistry(),
      makeExecutor() as unknown as ToolExecutor,
      new SnapshotManager(),
      noop
    );

    await loop.start('Hello', SCOPE, makeSingleTurnClient(textStream('Hi')), CFG);

    const totals = useStore.getState().currentSession?.totals;
    expect(totals?.inputTokens).toBe(10);
    expect(totals?.outputTokens).toBe(5);
  });

  it('isRunning returns false after completion', async () => {
    const loop = new AgentLoop(
      makeRegistry(),
      makeExecutor() as unknown as ToolExecutor,
      new SnapshotManager(),
      noop
    );
    await loop.start('Test', SCOPE, makeSingleTurnClient(textStream('ok')), CFG);
    expect(loop.isRunning()).toBe(false);
  });
});

describe('AgentLoop — non-mutating tool call', () => {
  it('executes tool, appends result, makes second LLM call, ends done', async () => {
    const spec: ToolSpec = {
      name: 'read_range',
      description: 'Read cells',
      parameters: { type: 'object', properties: { workbook_id: { type: 'string' }, sheet: { type: 'string' }, address: { type: 'string' } }, required: ['workbook_id', 'sheet', 'address'] },
      mutating: false,
    };
    const executor = makeExecutor([spec], { toolCallId: 'tc1', ok: true, data: { values: [['A']] } });

    const client = makeTwoTurnClient(
      toolCallStream('tc1', 'read_range', JSON.stringify({ workbook_id: 'wb1', sheet: 'Sheet1', address: 'A1' })),
      textStream('Cell A1 contains "A".')
    );

    const loop = new AgentLoop(
      makeRegistry(),
      executor as unknown as ToolExecutor,
      new SnapshotManager(),
      noop
    );

    await loop.start('What is in A1?', SCOPE, client, CFG);

    const state = useStore.getState();
    expect(state.currentSession?.status).toBe('done');

    const toolResultMsg = state.messages.find(m => m.role === 'tool');
    expect(toolResultMsg).toBeDefined();
    expect((toolResultMsg as { result: ToolResult }).result.ok).toBe(true);

    const assistantMsgs = state.messages.filter(m => m.role === 'assistant');
    const finalAssistant = assistantMsgs[assistantMsgs.length - 1];
    expect((finalAssistant as { text: string }).text).toBe('Cell A1 contains "A".');
  });
});

describe('AgentLoop — stop()', () => {
  it('stops a running loop and isRunning() returns false after the promise settles', async () => {
    let yieldControl!: () => void;
    async function* slowStream(): AsyncIterable<LLMStreamEvent> {
      await new Promise<void>(r => { yieldControl = r; });
      yield { type: 'done', finishReason: 'stop' };
    }

    const loop = new AgentLoop(
      makeRegistry(),
      makeExecutor() as unknown as ToolExecutor,
      new SnapshotManager(),
      noop
    );

    expect(loop.isRunning()).toBe(false);
    const p = loop.start('Slow task', SCOPE, makeSingleTurnClient(slowStream()), CFG);
    expect(loop.isRunning()).toBe(true);

    loop.stop();
    yieldControl();
    await p;

    // After stop + resolve, the loop must have terminated
    expect(loop.isRunning()).toBe(false);
    // Status is either 'done' (abort caught mid-stream non-throwing path) or 'stopped'
    const status = useStore.getState().currentSession?.status;
    expect(['done', 'stopped']).toContain(status);
  });
});

describe('AgentLoop — error handling', () => {
  it('catches LLM error event and sets session status to error', async () => {
    async function* errorStream(): AsyncIterable<LLMStreamEvent> {
      yield { type: 'error', error: { code: 'AuthError', message: 'Invalid API key' } };
    }

    const loop = new AgentLoop(
      makeRegistry(),
      makeExecutor() as unknown as ToolExecutor,
      new SnapshotManager(),
      noop
    );

    await loop.start('Hello', SCOPE, makeSingleTurnClient(errorStream()), CFG);

    const state = useStore.getState();
    expect(state.currentSession?.status).toBe('error');
    expect(state.currentSession?.lastError?.message).toContain('AuthError');
  });
});
