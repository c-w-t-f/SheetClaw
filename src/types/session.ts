import type { ToolCall } from './tool';
import type { PendingChoice } from '../agent/choice';

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
  | 'awaiting_choice'
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
  pendingChoice?: PendingChoice;
  webSearchEnabled: boolean;
  stopReason?: 'max_iterations';
  tokenBudget: { used: number; window: number };
  lastError?: { code: string; message: string };
  totals: { inputTokens: number; outputTokens: number; costUsd: number };
}
