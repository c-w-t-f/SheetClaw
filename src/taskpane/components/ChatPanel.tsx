import { useState, useRef, useEffect } from 'react';
import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Spinner,
  Textarea,
  tokens,
} from '@fluentui/react-components';
import { useStore } from '../../store/index';
import type { Message, CellDiff } from '../../types';
import { createAdapter } from '../../adapters/index';
import { getTaskpaneAgentLoop, getTaskpaneWorkbookLayer } from '../workbookLayer';

const STATUS_RUNNING = new Set(['building', 'calling_llm', 'parsing', 'executing_tool']);

const STATUS_LABELS: Record<string, string> = {
  building: 'Preparing context',
  calling_llm: 'Calling model',
  parsing: 'Reading response',
  executing_tool: 'Running workbook tool',
  awaiting_confirmation: 'Awaiting confirmation',
};

const EXAMPLE_PROMPTS = [
  'Summarize the active sheet',
  'Sum B2:B13 into B14',
  'Make a bar chart from A1:B12',
];

export default function ChatPanel({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [input, setInput] = useState('');
  const [initError, setInitError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const session = useStore(s => s.currentSession);
  const messages = useStore(s => s.messages);
  const providers = useStore(s => s.providers);
  const appConfig = useStore(s => s.appConfig);
  const authStates = useStore(s => s.authStates);
  const activeProviderReady = useStore(s => s.isProviderReady(s.appConfig.activeProvider));

  const isRunning = session ? STATUS_RUNNING.has(session.status) : false;
  const awaitingConfirm = session?.status === 'awaiting_confirmation';
  const activeProvider = providers[appConfig.activeProvider];
  const modelReady = !!activeProvider?.model.trim();
  const providerReady = !!activeProvider?.enabled && activeProviderReady && modelReady;
  const providerWarning = !activeProvider?.enabled
    ? 'No provider enabled. Configure one in Settings.'
    : !activeProviderReady
    ? 'Active provider is not authenticated. Configure auth in Settings.'
    : !modelReady
    ? 'Select a model in Settings before chatting.'
    : '';

  useEffect(() => {
    getTaskpaneWorkbookLayer().registry.refresh().catch(e => {
      setInitError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    if (!input.trim() || isRunning || !providerReady) return;
    const text = input.trim();
    setInput('');

    const provider = appConfig.activeProvider;
    const cfg = providers[provider];
    const authState = authStates[provider];
    const client = createAdapter(cfg, authState);
    const scope = { workbookId: getTaskpaneWorkbookLayer().registry.getActiveId() ?? 'host' };

    try {
      await getTaskpaneAgentLoop().start(text, scope, client, cfg);
    } catch {
      // Errors are captured inside loop.start and written to store.
    }
  }

  function stop() { getTaskpaneAgentLoop().stop(); }
  function applyConfirm() { getTaskpaneAgentLoop().resolveConfirmation('apply'); }
  function cancelConfirm() { getTaskpaneAgentLoop().resolveConfirmation('cancel'); }

  async function undo() {
    if (!session) return;
    const snap = getTaskpaneWorkbookLayer().snapshots.lastUndoable(session.id);
    if (!snap) return;
    try {
      await getTaskpaneWorkbookLayer().snapshots.undo(snap.id, fn => Excel.run(fn));
    } catch (e) {
      setInitError(e instanceof Error ? e.message : String(e));
    }
  }

  const visibleMessages = messages.filter(m => (m as Message & { sessionId?: string }).sessionId === session?.id);
  const showEmptyState = visibleMessages.length === 0 && !isRunning && !awaitingConfirm;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      padding: 12,
      gap: 8,
      boxSizing: 'border-box',
    }}>
      {initError && (
        <MessageBar intent="error">
          <MessageBarBody>{initError}</MessageBarBody>
        </MessageBar>
      )}

      {!providerReady && (
        <MessageBar intent="warning">
          <MessageBarBody>{providerWarning}</MessageBarBody>
          {onOpenSettings && (
            <MessageBarActions>
              <Button size="small" appearance="subtle" onClick={onOpenSettings}>Settings</Button>
            </MessageBarActions>
          )}
        </MessageBar>
      )}

      <div style={{
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {showEmptyState && (
          <EmptyChatState
            providerReady={providerReady}
            onPickPrompt={setInput}
            onOpenSettings={onOpenSettings}
          />
        )}
        {visibleMessages.map(m => (
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
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {STATUS_LABELS[session?.status ?? ''] ?? 'Running'}...
            </Caption1>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {session && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {session.model} | iter {session.iteration}/{session.maxIterations} | {session.totals.inputTokens + session.totals.outputTokens} tok
          </Caption1>
          <Button size="small" appearance="subtle" onClick={() => void undo()}>Undo last write</Button>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 96px',
        gap: 6,
        flexShrink: 0,
        alignItems: 'center',
      }}>
        <Textarea
          style={{ width: '100%', height: 32, minHeight: 32, maxHeight: 32 }}
          placeholder="Ask me anything..."
          value={input}
          onChange={(_, d) => setInput(d.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={isRunning || awaitingConfirm || !providerReady}
          resize="none"
        />
        {isRunning
          ? <Button appearance="secondary" onClick={stop}>Stop</Button>
          : <Button appearance="primary" onClick={() => void send()} disabled={!input.trim() || !providerReady}>Send</Button>
        }
      </div>
    </div>
  );
}

function EmptyChatState({
  providerReady,
  onPickPrompt,
  onOpenSettings,
}: {
  providerReady: boolean;
  onPickPrompt: (prompt: string) => void;
  onOpenSettings?: () => void;
}) {
  return (
    <div style={{
      margin: 'auto 0',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      alignItems: 'stretch',
    }}>
      <div>
        <Body1Strong>{providerReady ? 'Ready for this workbook' : 'Set up a provider to start'}</Body1Strong>
        <Caption1 style={{
          display: 'block',
          marginTop: 2,
          color: tokens.colorNeutralForeground3,
        }}>
          {providerReady
            ? 'Pick a starter prompt or ask your own question.'
            : 'Choose a provider, model, and authentication method in Settings.'}
        </Caption1>
      </div>
      {providerReady ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {EXAMPLE_PROMPTS.map(prompt => (
            <Button
              key={prompt}
              size="small"
              appearance="secondary"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => onPickPrompt(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      ) : onOpenSettings ? (
        <Button appearance="primary" size="small" onClick={onOpenSettings}>
          Open Settings
        </Button>
      ) : null}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system_notice';

  if (message.role === 'tool_call') {
    return (
      <Caption1 style={{ color: tokens.colorNeutralForeground3, fontFamily: 'monospace' }}>
        Tool: {message.toolCall.name}({JSON.stringify(message.toolCall.arguments).slice(0, 80)})
      </Caption1>
    );
  }
  if (message.role === 'tool') {
    const ok = message.result.ok;
    return (
      <Caption1 style={{ color: ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1, fontFamily: 'monospace' }}>
        {ok ? 'OK' : 'ERR'} {message.toolCallId.slice(0, 12)}... {ok ? JSON.stringify(message.result.data).slice(0, 80) : message.result.error?.message}
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
      <Body1Strong>Confirm change - {workbookName} / {sheet}</Body1Strong>
      {severity === 'elevated' && (
        <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>Large change - review carefully</Caption1>
      )}
      <div style={{ fontFamily: 'monospace', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {shown.map((d, i) => (
          <div key={i}>
            <span style={{ color: tokens.colorNeutralForeground3 }}>{d.address}: </span>
            <span style={{ color: tokens.colorPaletteRedForeground1 }}>{fmt(d.before)}</span>
            <span> to </span>
            <span style={{ color: tokens.colorPaletteGreenForeground1 }}>{fmt(d.after)}</span>
          </div>
        ))}
        {diff.length > MAX_SHOWN && (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>...and {diff.length - MAX_SHOWN} more cells</Caption1>
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
