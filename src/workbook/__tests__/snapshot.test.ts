import { describe, it, expect } from 'vitest';
import { SnapshotManager } from '../snapshot';
import type { ExcelRunner } from '../registry';

function makeRunner(ctx: object): ExcelRunner {
  return async fn => fn(ctx as Excel.RequestContext);
}

const SESSION = 'sess01';
const WB = 'wb01';

describe('SnapshotManager', () => {
  it('captureRange stores before values', async () => {
    const mockRange = {
      values: [['Hello', 42], [null, true]],
      formulas: [['Hello', 42], [null, true]],
      numberFormat: [['General', 'General'], ['General', 'General']],
      load: () => {},
    };
    const ctx = {
      workbook: { worksheets: { getItem: () => ({ getRange: () => mockRange }) } },
      sync: async () => {},
    };

    const sm = new SnapshotManager();
    const entry = await sm.captureRange(SESSION, WB, 'Sheet1', 'A1:B2', makeRunner(ctx));

    expect(entry.id).toBeTruthy();
    expect(entry.sessionId).toBe(SESSION);
    expect(entry.sheet).toBe('Sheet1');
    expect(entry.target).toBe('A1:B2');
    expect(entry.kind).toBe('range');
    expect(entry.undone).toBe(false);
    expect(entry.before.values).toEqual([['Hello', 42], [null, true]]);
  });

  it('list returns entries for the given session only', async () => {
    const mockRange = { values: [[1]], formulas: [[1]], numberFormat: [['General']], load: () => {} };
    const ctx = { workbook: { worksheets: { getItem: () => ({ getRange: () => mockRange }) } }, sync: async () => {} };
    const runner = makeRunner(ctx);

    const sm = new SnapshotManager();
    await sm.captureRange('sessA', WB, 'Sheet1', 'A1', runner);
    await sm.captureRange('sessB', WB, 'Sheet1', 'A2', runner);
    await sm.captureRange('sessA', WB, 'Sheet1', 'A3', runner);

    expect(sm.list('sessA')).toHaveLength(2);
    expect(sm.list('sessB')).toHaveLength(1);
  });

  it('undo restores formulas via runner', async () => {
    const writes: unknown[][][] = [];
    const mockRange = {
      values: [['old']],
      formulas: [['old']],
      numberFormat: [['General']],
      load: () => {},
    };
    const ctx = {
      workbook: {
        worksheets: {
          getItem: () => ({
            getRange: () => ({
              ...mockRange,
              set formulas(v: unknown) { writes.push(v as unknown[][][]); },
              set numberFormat(v: unknown) { void v; },
            }),
          }),
        },
      },
      sync: async () => {},
    };

    const sm = new SnapshotManager();
    const snap = await sm.captureRange(SESSION, WB, 'Sheet1', 'A1', makeRunner({
      workbook: { worksheets: { getItem: () => ({ getRange: () => mockRange }) } },
      sync: async () => {},
    }));

    await sm.undo(snap.id, makeRunner(ctx));

    expect(snap.undone).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('undo throws on unknown snapshot', async () => {
    const sm = new SnapshotManager();
    await expect(sm.undo('no-such-id', makeRunner({}))).rejects.toThrow('not found');
  });

  it('undo throws on already-undone snapshot', async () => {
    const mockRange = { values: [[1]], formulas: [[1]], numberFormat: [['G']], load: () => {} };
    const ctx = {
      workbook: { worksheets: { getItem: () => ({ getRange: () => ({ ...mockRange, formulas: null as unknown, numberFormat: null as unknown }) }) } },
      sync: async () => {},
    };

    const sm = new SnapshotManager();
    const snap = await sm.captureRange(SESSION, WB, 'Sheet1', 'A1', makeRunner({
      workbook: { worksheets: { getItem: () => ({ getRange: () => mockRange }) } },
      sync: async () => {},
    }));
    await sm.undo(snap.id, makeRunner(ctx));
    await expect(sm.undo(snap.id, makeRunner(ctx))).rejects.toThrow('already undone');
  });

  it('lastUndoable returns the most recent non-undone entry', async () => {
    const mockRange = { values: [[1]], formulas: [[1]], numberFormat: [['G']], load: () => {} };
    const readCtx = { workbook: { worksheets: { getItem: () => ({ getRange: () => mockRange }) } }, sync: async () => {} };

    const sm = new SnapshotManager();
    const a = await sm.captureRange(SESSION, WB, 'Sheet1', 'A1', makeRunner(readCtx));
    const b = await sm.captureRange(SESSION, WB, 'Sheet1', 'A2', makeRunner(readCtx));

    expect(sm.lastUndoable(SESSION)?.id).toBe(b.id);

    const undoCtx = {
      workbook: { worksheets: { getItem: () => ({ getRange: () => ({ ...mockRange, formulas: null as unknown, numberFormat: null as unknown }) }) } },
      sync: async () => {},
    };
    await sm.undo(b.id, makeRunner(undoCtx));
    expect(sm.lastUndoable(SESSION)?.id).toBe(a.id);
  });
});
