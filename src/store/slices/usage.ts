import type { StateCreator } from 'zustand';
import type { UsageRecord } from '../../types';
import { storage } from '../storage';

export interface SessionTotals {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
}

export interface UsageSlice {
  sessionTotals: SessionTotals | null;
  recordUsage(record: UsageRecord): void;
  resetSessionTotals(sessionId: string): void;
}

export const createUsageSlice: StateCreator<UsageSlice> = set => ({
  sessionTotals: null,

  recordUsage(record) {
    // Persist to daily bucket
    const day = record.timestamp.slice(0, 10);
    const key = `xl.usage.day.${day}`;
    const existing = storage.get<UsageRecord[]>(key) ?? [];
    storage.put(key, [...existing, record]);

    // Update in-memory session totals
    set(state => {
      const prev = state.sessionTotals;
      if (!prev || prev.sessionId !== record.sessionId) return {};
      return {
        sessionTotals: {
          ...prev,
          inputTokens: prev.inputTokens + record.inputTokens,
          outputTokens: prev.outputTokens + record.outputTokens,
          costUsd: prev.costUsd + record.estimatedCostUsd,
          turns: prev.turns + 1,
        },
      };
    });
  },

  resetSessionTotals(sessionId) {
    set({ sessionTotals: { sessionId, inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0 } });
  },
});
