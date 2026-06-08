import type { CellDiff } from '../types';

export function colIndexToLetter(col: number): string {
  let result = '';
  let n = col + 1;
  while (n > 0) {
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export function cellAddress(col: number, row: number): string {
  return `${colIndexToLetter(col)}${row + 1}`;
}

export function stripSheetPrefix(address: string): string {
  return address.includes('!') ? address.split('!')[1] : address;
}

export function parseRangeTopLeft(address: string): { col: number; row: number } {
  const clean = stripSheetPrefix(address);
  const topLeft = clean.split(':')[0];
  const m = topLeft.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Cannot parse range top-left from "${address}"`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2]) - 1 };
}

export function computeRangeDiff(
  rangeAddress: string,
  before: unknown[][],
  after: unknown[][]
): CellDiff[] {
  const { col: sc, row: sr } = parseRangeTopLeft(rangeAddress);
  const diffs: CellDiff[] = [];
  const rows = Math.max(before.length, after.length);
  for (let r = 0; r < rows; r++) {
    const cols = Math.max(before[r]?.length ?? 0, after[r]?.length ?? 0);
    for (let c = 0; c < cols; c++) {
      const bv = before[r]?.[c] ?? null;
      const av = after[r]?.[c] ?? null;
      if (bv !== av) {
        diffs.push({ address: cellAddress(sc + c, sr + r), before: bv, after: av });
      }
    }
  }
  return diffs;
}
