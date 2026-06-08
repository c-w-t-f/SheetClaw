import { ulid } from 'ulid';
import type { SnapshotEntry } from '../types';
import type { ExcelRunner } from './registry';

export class SnapshotManager {
  private entries = new Map<string, SnapshotEntry>();

  async captureRange(
    sessionId: string,
    workbookId: string,
    sheet: string,
    address: string,
    runner: ExcelRunner
  ): Promise<SnapshotEntry> {
    const id = ulid();
    const before = await runner(async ctx => {
      const range = ctx.workbook.worksheets.getItem(sheet).getRange(address);
      range.load('values,formulas,numberFormat');
      await ctx.sync();
      return {
        values: range.values as unknown[][],
        formulas: range.formulas as unknown[][],
        numberFormat: range.numberFormat as string[][],
      };
    });

    const entry: SnapshotEntry = {
      id,
      sessionId,
      workbookId,
      sheet,
      kind: 'range',
      target: address,
      before,
      createdAt: new Date().toISOString(),
      undone: false,
      restoreFidelity: 'full',
    };
    this.entries.set(id, entry);
    return entry;
  }

  async undo(snapshotId: string, runner: ExcelRunner): Promise<void> {
    const entry = this.entries.get(snapshotId);
    if (!entry) throw new Error(`Snapshot not found: ${snapshotId}`);
    if (entry.undone) throw new Error(`Snapshot already undone: ${snapshotId}`);
    if (entry.kind !== 'range') throw new Error('Only range snapshots supported in Phase 5');

    await runner(async ctx => {
      const range = ctx.workbook.worksheets.getItem(entry.sheet).getRange(entry.target);
      if (entry.before.formulas) {
        range.formulas = entry.before.formulas as string[][];
      } else if (entry.before.values) {
        range.values = entry.before.values as (string | number | boolean)[][];
      }
      if (entry.before.numberFormat) {
        range.numberFormat = entry.before.numberFormat as string[][];
      }
      await ctx.sync();
    });

    entry.undone = true;
  }

  get(id: string): SnapshotEntry | undefined { return this.entries.get(id); }

  list(sessionId: string): SnapshotEntry[] {
    return Array.from(this.entries.values()).filter(e => e.sessionId === sessionId);
  }

  lastUndoable(sessionId: string): SnapshotEntry | undefined {
    const items = this.list(sessionId).filter(e => !e.undone);
    return items[items.length - 1];
  }
}
