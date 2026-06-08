export interface SnapshotEntry {
  id: string;
  sessionId: string;
  workbookId: string;
  sheet: string;
  kind: 'range' | 'chart' | 'pivot' | 'sheet';
  target: string;
  before: {
    values?: unknown[][];
    formulas?: unknown[][];
    numberFormat?: string[][];
    definition?: unknown;
  };
  payloadRef?: string;
  createdAt: string;
  appliedToolCallId?: string;
  undone: boolean;
  restoreFidelity: 'full' | 'values-only' | 'structural-coarse';
}
