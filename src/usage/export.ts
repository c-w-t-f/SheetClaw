import type { UsageRecord } from '../types';
import { loadBuckets, rangeFrom, type TimeRange } from './queries';

const CSV_HEADER = 'timestamp,session_id,turn_index,provider,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,estimated,tool_calls\r\n';

function escapeField(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function recordToRow(r: UsageRecord): string {
  return [
    r.timestamp,
    r.sessionId,
    r.turnIndex,
    r.provider,
    r.model,
    r.inputTokens,
    r.outputTokens,
    r.cacheReadTokens ?? 0,
    r.cacheWriteTokens ?? 0,
    r.totalTokens,
    r.estimated,
    r.toolCallsCount,
  ].map(escapeField).join(',') + '\r\n';
}

export function exportCsv(range: TimeRange = 'month'): void {
  const { from, to } = rangeFrom(range);
  const records = loadBuckets(from, to).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // BOM prefix so Excel opens UTF-8 correctly
  const bom = '﻿';
  const rows = records.map(recordToRow).join('');
  const content = bom + CSV_HEADER + rows;

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `usage-${from}-to-${to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
