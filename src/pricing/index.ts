import type { PricingTable, PricingEntry, UsageRecord } from '../types';
import bundled from './pricing.json';

export const DEFAULT_PRICING: PricingTable = bundled as PricingTable;

function matchesModel(entry: PricingEntry, provider: string, model: string): boolean {
  if (entry.provider !== provider && entry.provider !== '*') return false;
  const pattern = entry.modelMatch;
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return model.startsWith(pattern.slice(0, -1));
  return model === pattern;
}

export function findPricing(provider: string, model: string, table: PricingTable = DEFAULT_PRICING): PricingEntry | null {
  // Exact match first, then prefix/glob
  const exact = table.entries.find(e => matchesModel(e, provider, model) && !e.modelMatch.includes('*'));
  if (exact) return exact;
  const glob = table.entries.find(e => matchesModel(e, provider, model));
  return glob ?? null;
}

export function computeCost(
  record: Pick<UsageRecord, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>,
  entry: PricingEntry | null,
  defaults: PricingTable['defaults'] = DEFAULT_PRICING.defaults
): number {
  const rates = entry ?? { inputPerMTok: defaults.inputPerMTok, outputPerMTok: defaults.outputPerMTok };
  const cacheReadRate = ('cacheReadPerMTok' in rates && rates.cacheReadPerMTok != null)
    ? rates.cacheReadPerMTok
    : rates.inputPerMTok;

  const cacheWriteRate = ('cacheWritePerMTok' in rates && rates.cacheWritePerMTok != null)
    ? rates.cacheWritePerMTok
    : rates.inputPerMTok;

  const cacheRead = record.cacheReadTokens ?? 0;
  const cacheWrite = record.cacheWriteTokens ?? 0;
  const regularInput = Math.max(0, record.inputTokens - cacheRead);

  return (
    (regularInput / 1e6) * rates.inputPerMTok +
    (cacheRead / 1e6) * cacheReadRate +
    (cacheWrite / 1e6) * cacheWriteRate +
    (record.outputTokens / 1e6) * rates.outputPerMTok
  );
}
