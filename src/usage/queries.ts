import type { UsageRecord } from '../types';
import { storage } from '../store/storage';

// ── Day-bucket loading ─────────────────────────────────────────────────────

export function loadBuckets(fromDay: string, toDay: string): UsageRecord[] {
  const records: UsageRecord[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith('xl.usage.day.')) continue;
    const day = k.slice('xl.usage.day.'.length);
    if (day >= fromDay && day <= toDay) {
      const bucket = storage.get<UsageRecord[]>(k);
      if (Array.isArray(bucket)) records.push(...bucket);
    }
  }
  return records;
}

// ── Date helpers ───────────────────────────────────────────────────────────

export function today(): string { return new Date().toISOString().slice(0, 10); }

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Aggregation ────────────────────────────────────────────────────────────

export type TimeRange = 'today' | 'week' | 'month' | 'all';

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  turns: number;
  estimatedCount: number;
}

export interface BreakdownRow {
  key: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  turns: number;
}

export interface DayRow {
  day: string;
  costUsd: number;
  totalTokens: number;
}

export function rangeFrom(range: TimeRange): { from: string; to: string } {
  const to = today();
  switch (range) {
    case 'today': return { from: to, to };
    case 'week':  return { from: daysAgo(6), to };
    case 'month': return { from: daysAgo(29), to };
    case 'all':   return { from: '2000-01-01', to };
  }
}

function sumTotals(records: UsageRecord[]): UsageTotals {
  return records.reduce<UsageTotals>((acc, r) => ({
    inputTokens:    acc.inputTokens + r.inputTokens,
    outputTokens:   acc.outputTokens + r.outputTokens,
    totalTokens:    acc.totalTokens + r.totalTokens,
    costUsd:        acc.costUsd + r.estimatedCostUsd,
    turns:          acc.turns + 1,
    estimatedCount: acc.estimatedCount + (r.estimated ? 1 : 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, turns: 0, estimatedCount: 0 });
}

export function queryTotals(range: TimeRange): UsageTotals {
  const { from, to } = rangeFrom(range);
  return sumTotals(loadBuckets(from, to));
}

export function queryByProvider(range: TimeRange): BreakdownRow[] {
  const { from, to } = rangeFrom(range);
  const records = loadBuckets(from, to);
  const map = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const arr = map.get(r.provider) ?? [];
    arr.push(r);
    map.set(r.provider, arr);
  }
  return Array.from(map.entries()).map(([key, recs]) => {
    const t = sumTotals(recs);
    return { key, ...t };
  });
}

export function queryByModel(range: TimeRange): BreakdownRow[] {
  const { from, to } = rangeFrom(range);
  const records = loadBuckets(from, to);
  const map = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const key = `${r.provider}/${r.model}`;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([key, recs]) => {
    const t = sumTotals(recs);
    return { key, ...t };
  });
}

export function queryByDay(range: TimeRange): DayRow[] {
  const { from, to } = rangeFrom(range);
  const records = loadBuckets(from, to);
  const map = new Map<string, { costUsd: number; totalTokens: number }>();
  for (const r of records) {
    const day = r.timestamp.slice(0, 10);
    const prev = map.get(day) ?? { costUsd: 0, totalTokens: 0 };
    map.set(day, { costUsd: prev.costUsd + r.estimatedCostUsd, totalTokens: prev.totalTokens + r.totalTokens });
  }
  return Array.from(map.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
