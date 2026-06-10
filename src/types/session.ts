import type { ToolCall } from './tool';

export interface SessionScope {
  workbookId: string;
}

export interface CellDiff {
  address: string;
  before: unknown;
  after: unknown;
}

export interface PendingChange {
  id: string;
  toolCall: ToolCall;
  snapshotId: string;
  diff: CellDiff[];
  severity: 'normal' | 'elevated';
  workbookName: string;
  sheet: string;
}

export type SessionStatus =
  | 'idle'
  | 'building'
  | 'calling_llm'
  | 'parsing'
  | 'awaiting_confirmation'
  | 'executing_tool'
  | 'error'
  | 'done'
  | 'stopped';

export interface AgentSession {
  id: string;
  createdAt: string;
  scope: SessionScope;
  status: SessionStatus;
  iteration: number;
  maxIterations: number;
  provider: string;
  model: string;
  messageIds: string[];
  pendingChange?: PendingChange;
  webSearchEnabled: boolean;
  tokenBudget: { used: number; window: number };
  lastError?: { code: string; message: string };
  totals: { inputTokens: number; outputTokens: number; costUsd: number };
}
