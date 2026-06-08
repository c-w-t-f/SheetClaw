import { useState, useRef, useEffect } from 'react';
import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import { useStore } from '../../store/index';
import type { Message, CellDiff } from '../../types';
import { createWorkbookLayer } from '../../workbook/index';
import { getAgentLoop } from '../../agent/index';
import { createAdapter } from '../../adapters/index';

// ── Lazy-init the workbook layer + agent loop ──────────────────────────────
// Singletons — created once when ChatPanel first mounts.

let _layer: ReturnType<typeof createWorkbookLayer> | null = null;

function getLayer() {
  if (!_layer) _layer = createWorkbookLayer();
  return _layer;
}

function getLoop() {
  const { registry, executor, snapshots } = getLayer();
  return getAgentLoop(registry, executor, snapshots);
}

// ── Status colours ─────────────────────────────────────────────────────────

const STATUS_RUNNING = new Set(['building', 'calling_llm', 'parsing', 'executing_tool']);

// ── ChatPanel ──────────────────────────────────────────────────────────────

export default function ChatPanel() {
  const [input, setInput] = useState('');
  const [initError, setInitError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const session = useStore(s => s.currentSession);
  const messages = useStore(s => s.messages);
  const providers = useStore(s => s.providers);
  const appConfig = useStore(s => s.appConfig);
  const authStates = useStore(s => s.authStates);

  const isRunning = session ? STATUS_RUNNING.has(session.status) : false;
  const awaitingConfirm = session?.status === 'awaiting_confirmation';
  const activeProvider = providers[appConfig.activeProvider];

  // Refresh workbook registry on first mount
  useEffect(() => {
    getLayer().registry.refresh().catch(e => {
      setInitError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    if (!input.trim() || isRunning) return;
    const text = input.trim();
    setInput('');

    const provider = appConfig.activeProvider;
    const cfg = providers[provider];
    const authState = authStates[provider];

    // Get API key from auth state (masked key is just for display; actual stored key needed)
    // For now, prompt via storage key until Phase 8 auth is complete
    const apiKey = (authState as { _key?: string })._key ?? '';

    const client = createAdapter(cfg, apiKey);
    const scope = { workbookId: getLayer().registry.getActiveId() ?? 'host' };

    try {
      await getLoop().start(text, scope, client, cfg);
    } catch {
      // Errors are captured inside loop.start and written to store
    }
  }

  function stop() { getLoop().stop(); }
  function applyConfirm() { getLoop().resolveConfirmation('apply'); }
  function cancelConfirm() { getLoop().resolveConfirmation('cancel'); }

  async function undo() {
    if (!session) return;
    const snap = getLayer().snapshots.lastUndoable(session.id);
    if (!snap) return;
    try {
      await getLayer().snapshots.undo(snap.id, fn => Excel.run(fn));
    } catch (e) {
      setInitError(e instanceof Error ? e.message : String(e));
    }
  }

  const providerReady = activeProvider?.enabled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12, gap: 8 }}>
      {initError && (
        <MessageBar intent="error">
          <MessageBarBody>{initError}</MessageBarBody>
        </MessageBar>
      )}

      {!providerReady && (
        <MessageBar intent="warning">
          <MessageBarBody>No provider enabled. Configure one in Settings.</MessageBarBody>
        </MessageBar>
      )}

      {/* Message list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        {messages.filter(m => (m as Message & { sessionId?: string }).sessionId === session?.id).map(m => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {awaitingConfirm && session?.pendingChange && (
          <ConfirmationBlock
            diff={session.pendingChange.diff}
            sheet={session.pendingChange.sheet}
            workbookName={session.pendingChange.workbookName}
            severity={session.pendingChange.severity}
            onApply={applyConfirm}
            onCancel={cancelConfirm}
          />
        )}
        {isRunning && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Spinner size="extra-small" />
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{session?.status ?? 'running'}…</Caption1>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <Input
          style={{ flex: 1 }}
          placeholder="Ask something about this workbook…"
          value={input}
          onChange={(_, d) => setInput(d.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          disabled={isRunning || awaitingConfirm || !providerReady}
        />
        {isRunning
          ? <Button appearance="secondary" onClick={stop}>Stop</Button>
          : <Button appearance="primary" onClick={() => void send()} disabled={!input.trim() || !providerReady}>Send</Button>
        }
      </div>

      {/* Session footer */}
      {session && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {session.model} · iter {session.iteration}/{session.maxIterations} · {session.totals.inputTokens + session.totals.outputTokens} tok
          </Caption1>
          <Button size="small" appearance="subtle" onClick={() => void undo()}>Undo last write</Button>
        </div>
      )}
    </div>
  );
}

// ── MessageBubble ──────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system_notice';

  if (message.role === 'tool_call') {
    return (
      <Caption1 style={{ color: tokens.colorNeutralForeground3, fontFamily: 'monospace' }}>
        ⚙ {message.toolCall.name}({JSON.stringify(message.toolCall.arguments).slice(0, 80)})
      </Caption1>
    );
  }
  if (message.role === 'tool') {
    const ok = message.result.ok;
    return (
      <Caption1 style={{ color: ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1, fontFamily: 'monospace' }}>
        {ok ? '✓' : '✗'} {message.toolCallId.slice(0, 12)}… {ok ? JSON.stringify(message.result.data).slice(0, 80) : message.result.error?.message}
      </Caption1>
    );
  }
  if (message.role === 'confirmation') return null;
  if (isSystem) {
    const intent = message.level === 'error' ? 'error' : message.level === 'warn' ? 'warning' : 'info';
    return (
      <MessageBar intent={intent}>
        <MessageBarBody><Caption1>{message.text}</Caption1></MessageBarBody>
      </MessageBar>
    );
  }

  return (
    <div style={{
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      maxWidth: '85%',
      background: isUser ? tokens.colorBrandBackground : tokens.colorNeutralBackground2,
      color: isUser ? tokens.colorNeutralForegroundOnBrand : tokens.colorNeutralForeground1,
      borderRadius: 8,
      padding: '8px 12px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      <Body1>{message.role === 'assistant' || message.role === 'user' ? message.text : ''}</Body1>
    </div>
  );
}

// ── ConfirmationBlock ──────────────────────────────────────────────────────

function ConfirmationBlock({
  diff, sheet, workbookName, severity, onApply, onCancel,
}: {
  diff: CellDiff[];
  sheet: string;
  workbookName: string;
  severity: 'normal' | 'elevated';
  onApply: () => void;
  onCancel: () => void;
}) {
  const MAX_SHOWN = 10;
  const shown = diff.slice(0, MAX_SHOWN);

  return (
    <div style={{
      border: `1px solid ${severity === 'elevated' ? tokens.colorPaletteRedBorder2 : tokens.colorNeutralStroke1}`,
      borderRadius: 6,
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      background: tokens.colorNeutralBackground1,
    }}>
      <Body1Strong>Confirm change — {workbookName} / {sheet}</Body1Strong>
      {severity === 'elevated' && (
        <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>⚠ Large change — review carefully</Caption1>
      )}
      <div style={{ fontFamily: 'monospace', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {shown.map((d, i) => (
          <div key={i}>
            <span style={{ color: tokens.colorNeutralForeground3 }}>{d.address}: </span>
            <span style={{ color: tokens.colorPaletteRedForeground1 }}>{fmt(d.before)}</span>
            <span> → </span>
            <span style={{ color: tokens.colorPaletteGreenForeground1 }}>{fmt(d.after)}</span>
          </div>
        ))}
        {diff.length > MAX_SHOWN && (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>…and {diff.length - MAX_SHOWN} more cells</Caption1>
        )}
        {diff.length === 0 && <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>(no cell values change)</Caption1>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button appearance="primary" onClick={onApply}>Apply</Button>
        <Button appearance="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  return String(v).slice(0, 40);
}
