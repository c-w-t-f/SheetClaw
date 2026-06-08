import { ulid } from 'ulid';
import type {
  LLMClient,
  ToolCall,
  AgentSession,
  SessionScope,
  ProviderConfig,
  Message,
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  ToolResultMessage,
  SystemNoticeMessage,
} from '../types';
import type { WorkbookRegistry } from '../workbook/registry';
import { ToolExecutor } from '../workbook/executor';
import { SnapshotManager } from '../workbook/snapshot';
import { ContextBuilder } from './context-builder';
import { computeRangeDiff } from '../workbook/a1notation';
import { useStore } from '../store/index';

const MAX_ITERATIONS = 25;
export type LoopRunner = <T>(fn: (ctx: Excel.RequestContext) => Promise<T>) => Promise<T>;

// ── Tool-call accumulator for streaming ────────────────────────────────────

interface StreamResult {
  streamMsgId: string;
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown>; rawArgs: string }>;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
}

// ── AgentLoop ──────────────────────────────────────────────────────────────

export class AgentLoop {
  private abortController: AbortController | null = null;
  private confirmationResolve: ((d: 'apply' | 'cancel') => void) | null = null;
  private runner: LoopRunner;

  constructor(
    private registry: WorkbookRegistry,
    private executor: ToolExecutor,
    private snapshots: SnapshotManager,
    runner?: LoopRunner
  ) {
    this.runner = runner ?? (fn => Excel.run(fn));
  }

  // ── Public ─────────────────────────────────────────────────────────────

  async start(
    instruction: string,
    scope: SessionScope,
    client: LLMClient,
    cfg: ProviderConfig
  ): Promise<void> {
    const ac = new AbortController();
    this.abortController = ac;

    const session: AgentSession = {
      id: ulid(),
      createdAt: new Date().toISOString(),
      scope,
      status: 'building',
      iteration: 0,
      maxIterations: MAX_ITERATIONS,
      provider: cfg.provider,
      model: cfg.model,
      messageIds: [],
      tokenBudget: { used: 0, window: cfg.contextLimits.maxContextTokens },
      totals: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };

    const store = useStore.getState();
    store.setSession(session);
    store.resetSessionTotals(session.id);

    this.append(session.id, msg<UserMessage>(session.id, { role: 'user', text: instruction }));

    const ctxBuilder = new ContextBuilder(this.registry);

    try {
      await this.loop(session, client, cfg, ctxBuilder, ac.signal);
    } catch (e) {
      if (ac.signal.aborted) {
        useStore.getState().updateSession({ status: 'stopped' });
      } else {
        const message = e instanceof Error ? e.message : String(e);
        useStore.getState().updateSession({ status: 'error', lastError: { code: 'LoopError', message } });
        this.append(session.id, msg<SystemNoticeMessage>(session.id, { role: 'system_notice', level: 'error', text: `Run failed: ${message}` }));
      }
    } finally {
      this.abortController = null;
    }
  }

  stop(): void {
    this.abortController?.abort();
    this.confirmationResolve = null;
  }

  resolveConfirmation(decision: 'apply' | 'cancel'): void {
    this.confirmationResolve?.(decision);
    this.confirmationResolve = null;
  }

  isRunning(): boolean { return this.abortController !== null; }

  // ── Loop ───────────────────────────────────────────────────────────────

  private async loop(
    session: AgentSession,
    client: LLMClient,
    cfg: ProviderConfig,
    ctxBuilder: ContextBuilder,
    signal: AbortSignal
  ): Promise<void> {
    const toolSpecs = this.executor.getToolSpecs();

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (signal.aborted) return;
      useStore.getState().updateSession({ iteration: iter + 1, status: 'building' });

      const messages = useStore.getState().messages.filter(
        m => (m as Message & { sessionId: string }).sessionId === session.id
      );
      const req = ctxBuilder.build(session, messages, toolSpecs, cfg);
      useStore.getState().updateSession({ status: 'calling_llm' });

      const sr = await this.stream(session, client, req, signal);

      // Update session totals
      const t = useStore.getState().currentSession?.totals ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      useStore.getState().updateSession({
        totals: { ...t, inputTokens: t.inputTokens + sr.inputTokens, outputTokens: t.outputTokens + sr.outputTokens },
      });

      // Resolve mutating flags from tool specs
      const calls: ToolCall[] = sr.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.args,
        rawArguments: tc.rawArgs,
        workbookId: session.scope.workbookId,
        mutating: toolSpecs.find(s => s.name === tc.name)?.mutating ?? false,
      }));

      // Finalise the streaming assistant message (update toolCalls in-place)
      useStore.getState().updateMessage(sr.streamMsgId, {
        toolCalls: calls.length ? calls : undefined,
        finishReason: (sr.finishReason as AssistantMessage['finishReason']) ?? 'stop',
      } as Partial<Message>);

      if (!calls.length || sr.finishReason === 'stop') {
        useStore.getState().updateSession({ status: 'done' });
        return;
      }
      if (sr.finishReason === 'length') {
        this.append(session.id, msg<SystemNoticeMessage>(session.id, {
          role: 'system_notice', level: 'warn',
          text: 'Response cut off at token limit — the model may not have finished.',
        }));
        useStore.getState().updateSession({ status: 'done' });
        return;
      }

      // Execute tool calls sequentially
      useStore.getState().updateSession({ status: 'executing_tool' });
      for (const call of calls) {
        if (signal.aborted) return;
        await this.executeCall(call, session, signal);
      }
    }

    useStore.getState().updateSession({ status: 'done' });
    this.append(session.id, msg<SystemNoticeMessage>(session.id, {
      role: 'system_notice', level: 'warn',
      text: `Stopped after ${MAX_ITERATIONS} iterations. The task may be incomplete.`,
    }));
  }

  // ── Streaming ──────────────────────────────────────────────────────────

  private async stream(
    session: AgentSession,
    client: LLMClient,
    req: ReturnType<ContextBuilder['build']>,
    signal: AbortSignal
  ): Promise<StreamResult> {
    // Append a streaming assistant message — update its text live as deltas arrive
    const streamMsg = msg<AssistantMessage>(session.id, { role: 'assistant', text: '' });
    this.append(session.id, streamMsg);

    let text = '';
    let finishReason = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;
    const accum: Record<number, { id: string; name: string; argsBuf: string }> = {};

    useStore.getState().updateSession({ status: 'parsing' });

    for await (const ev of client.chat(req, signal)) {
      if (signal.aborted) break;
      switch (ev.type) {
        case 'text-delta':
          text += ev.delta;
          useStore.getState().updateMessage(streamMsg.id, { text } as Partial<Message>);
          break;
        case 'tool-call-start':
          accum[ev.index] = { id: ev.id, name: ev.name, argsBuf: '' };
          break;
        case 'tool-call-delta':
          if (accum[ev.index]) accum[ev.index].argsBuf += ev.argumentsDelta;
          break;
        case 'usage':
          inputTokens = ev.inputTokens;
          outputTokens = ev.outputTokens;
          break;
        case 'done':
          finishReason = ev.finishReason;
          break;
        case 'error':
          throw new Error(`${ev.error.code}: ${ev.error.message}`);
      }
    }

    const toolCalls = Object.values(accum).map(a => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(a.argsBuf) as Record<string, unknown>; } catch { /* leave empty */ }
      return { id: a.id, name: a.name, args, rawArgs: a.argsBuf };
    });

    // Append tool-call UI messages
    for (const tc of toolCalls) {
      this.append(session.id, msg<ToolCallMessage>(session.id, {
        role: 'tool_call',
        toolCall: { id: tc.id, name: tc.name, arguments: tc.args, workbookId: session.scope.workbookId, mutating: false },
        status: 'pending',
      }));
    }

    return { streamMsgId: streamMsg.id, text, toolCalls, finishReason, inputTokens, outputTokens };
  }

  // ── Tool execution ─────────────────────────────────────────────────────

  private async executeCall(call: ToolCall, session: AgentSession, signal: AbortSignal): Promise<void> {
    const scope = { workbookId: session.scope.workbookId };

    if (!call.mutating) {
      const result = await this.executor.execute(call, scope);
      this.append(session.id, msg<ToolResultMessage>(session.id, { role: 'tool', toolCallId: call.id, result }));
      return;
    }

    // Mutating: capture → diff → confirm → apply/cancel
    const sheet = call.arguments.sheet as string | undefined;
    const address = call.arguments.address as string | undefined;

    let snapshotId: string | undefined;
    try {
      if (sheet && address) {
        const snap = await this.snapshots.captureRange(session.id, session.scope.workbookId, sheet, address, this.runner);
        snapshotId = snap.id;

        const proposed = call.arguments.values as unknown[][] | undefined;
        const diff = proposed ? computeRangeDiff(address, snap.before.values ?? [], proposed) : [];
        const wb = this.registry.getManifest().workbooks[0];

        useStore.getState().updateSession({
          status: 'awaiting_confirmation',
          pendingChange: {
            id: ulid(), toolCall: call, snapshotId: snap.id, diff,
            severity: diff.length > 50 ? 'elevated' : 'normal',
            workbookName: wb?.name ?? 'Workbook', sheet,
          },
        });
      } else {
        useStore.getState().updateSession({ status: 'awaiting_confirmation' });
      }
    } catch (captureErr) {
      const message = captureErr instanceof Error ? captureErr.message : String(captureErr);
      const result = { toolCallId: call.id, ok: false as const, error: { code: 'OfficeApiError' as const, message: `Snapshot failed: ${message}` } };
      this.append(session.id, msg<ToolResultMessage>(session.id, { role: 'tool', toolCallId: call.id, result }));
      return;
    }

    // Pause until user decides
    const decision = await this.waitForConfirmation(signal);
    useStore.getState().updateSession({ status: 'executing_tool', pendingChange: undefined });

    if (decision === 'cancel') {
      const result = { toolCallId: call.id, ok: false as const, error: { code: 'PermissionDenied' as const, message: 'User cancelled the write.' } };
      this.append(session.id, msg<ToolResultMessage>(session.id, { role: 'tool', toolCallId: call.id, result }));
      return;
    }

    const result = await this.executor.execute(call, scope);
    if (snapshotId) result.snapshotId = snapshotId;
    this.append(session.id, msg<ToolResultMessage>(session.id, { role: 'tool', toolCallId: call.id, result }));
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private waitForConfirmation(signal: AbortSignal): Promise<'apply' | 'cancel'> {
    return new Promise((resolve, reject) => {
      this.confirmationResolve = resolve;
      signal.addEventListener('abort', () => {
        this.confirmationResolve = null;
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }

  private append(sessionId: string, message: Message): void {
    void sessionId;
    useStore.getState().appendMessage(message);
  }
}

// ── Message factory ────────────────────────────────────────────────────────

function msg<T extends Message>(sessionId: string, fields: Omit<T, 'id' | 'sessionId' | 'createdAt'>): T {
  return { id: ulid(), sessionId, createdAt: new Date().toISOString(), ...fields } as unknown as T;
}
