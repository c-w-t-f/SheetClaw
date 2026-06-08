import { describe, it, expect } from 'vitest';
import { WorkbookRegistry } from '../registry';
import { ToolExecutor } from '../executor';
import type { ExcelRunner } from '../registry';
import type { ToolCall } from '../../types';
import {
  PIVOT_SPECS,
  handleListPivots,
  handleGetPivot,
  handleCreatePivot,
  handleAddPivotField,
  handleRefreshPivot,
} from '../tools/pivots';

// ── Helpers ────────────────────────────────────────────────────────────────

const HOST_ID = 'wb1';
const SCOPE = { workbookId: HOST_ID };

function makeRunner(ctx: object): ExcelRunner {
  return async fn => fn(ctx as Excel.RequestContext);
}

function makeCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `call_${name}`, name, arguments: args, workbookId: HOST_ID, mutating: false };
}

function makeRegistry(): WorkbookRegistry {
  const r = new WorkbookRegistry();
  (r as unknown as { handles: Map<string, unknown>; activeId: string; hostId: string }).handles.set(HOST_ID, {
    workbookId: HOST_ID, name: 'TestBook.xlsx', isActive: true, isHost: true,
    sheets: [], lastRefreshed: new Date().toISOString(), capability: 'host-only',
  });
  (r as unknown as { activeId: string; hostId: string }).activeId = HOST_ID;
  (r as unknown as { hostId: string }).hostId = HOST_ID;
  return r;
}

// ── capability gating ──────────────────────────────────────────────────────

describe('pivot capability gating', () => {
  it('returns Unsupported when pivotTables API is absent', async () => {
    const ctx = {
      workbook: {}, // no pivotTables property
      sync: async () => {},
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(PIVOT_SPECS[0], handleListPivots);

    const r = await executor.execute(makeCall('list_pivots', { workbook_id: HOST_ID }), SCOPE);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('Unsupported');
    expect(r.error?.message).toMatch(/ExcelApi 1\.8/);
  });
});

// ── list_pivots ────────────────────────────────────────────────────────────

describe('list_pivots handler', () => {
  it('returns pivot names for a given sheet', async () => {
    const mockPivots = {
      items: [{ name: 'SalesPivot' }, { name: 'RegionPivot' }],
      load: () => {},
    };
    const ctx = {
      workbook: {
        pivotTables: { items: [], load: () => {} },
        worksheets: { getItem: () => ({ pivotTables: mockPivots }) },
      },
      sync: async () => {},
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(PIVOT_SPECS[0], handleListPivots);

    const r = await executor.execute(makeCall('list_pivots', { workbook_id: HOST_ID, sheet: 'Sheet1' }), SCOPE);
    expect(r.ok).toBe(true);
    const data = r.data as Array<{ name: string }>;
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('SalesPivot');
  });

  it('returns pivot names across workbook when sheet is omitted', async () => {
    const ctx = {
      workbook: {
        pivotTables: {
          items: [
            { name: 'PT1', worksheet: { name: 'Sheet1' } },
            { name: 'PT2', worksheet: { name: 'Sheet2' } },
          ],
          load: () => {},
        },
        worksheets: { getItem: () => ({}) },
      },
      sync: async () => {},
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(PIVOT_SPECS[0], handleListPivots);

    const r = await executor.execute(makeCall('list_pivots', { workbook_id: HOST_ID }), SCOPE);
    expect(r.ok).toBe(true);
    const data = r.data as Array<{ name: string; sheet?: string }>;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ name: 'PT1', sheet: 'Sheet1' });
  });
});

// ── get_pivot ──────────────────────────────────────────────────────────────

describe('get_pivot handler', () => {
  it('returns field layout of a pivot table', async () => {
    const mockPivot = {
      rowHierarchies:    { items: [{ name: 'Region' }], load: () => {} },
      columnHierarchies: { items: [{ name: 'Quarter' }], load: () => {} },
      dataHierarchies:   { items: [{ name: 'Sales', summarizeBy: 'Sum' }], load: () => {} },
      filterHierarchies: { items: [], load: () => {} },
      hierarchies:       { items: [{ name: 'Region' }, { name: 'Quarter' }, { name: 'Sales' }], load: () => {} },
    };
    const ctx = {
      workbook: {
        pivotTables: { items: [], load: () => {}, getItem: () => mockPivot },
        worksheets: { getItem: () => ({}) },
      },
      sync: async () => {},
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(PIVOT_SPECS[1], handleGetPivot);

    const r = await executor.execute(makeCall('get_pivot', { workbook_id: HOST_ID, name: 'SalesPivot' }), SCOPE);
    expect(r.ok).toBe(true);
    const data = r.data as { rows: string[]; columns: string[]; data: unknown[]; filters: string[] };
    expect(data.rows).toEqual(['Region']);
    expect(data.columns).toEqual(['Quarter']);
    expect(data.data).toHaveLength(1);
    expect(data.filters).toEqual([]);
  });
});

// ── create_pivot ───────────────────────────────────────────────────────────

describe('create_pivot handler', () => {
  it('creates a pivot and returns its name', async () => {
    const mockPivot = { name: 'PivotTable1', load: () => {} };
    const ctx = {
      workbook: {
        pivotTables: { items: [], load: () => {}, add: () => mockPivot },
        worksheets: {
          getItem: () => ({
            getRange: () => ({}),
            pivotTables: { add: () => mockPivot },
          }),
        },
      },
      sync: async () => {},
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(PIVOT_SPECS[2], handleCreatePivot);

    const r = await executor.execute(
      makeCall('create_pivot', { workbook_id: HOST_ID, sheet: 'Sheet1', source_range: 'A1:D100', destination: 'F1' }),
      SCOPE
    );
    expect(r.ok).toBe(true);
    expect((r.data as { name: string }).name).toBe('PivotTable1');
    expect((r.data as { created: boolean }).created).toBe(true);
  });
});

// ── add_pivot_field ────────────────────────────────────────────────────────

describe('add_pivot_field handler', () => {
  it('adds a field to the row area', async () => {
    let addedHierarchy: unknown = null;
    const mockRegionHierarchy = { name: 'Region' };
    const mockPivot = {
      hierarchies: { items: [mockRegionHierarchy, { name: 'Sales' }], load: () => {} },
      rowHierarchies: { add: (h: unknown) => { addedHierarchy = h; } },
      columnHierarchies: { add: () => {} },
      filterHierarchies: { add: () => {} },
      dataHierarchies: { add: () => ({ summarizeBy: '' }) },
    };
    const ctx = {
      workbook: {
        pivotTables: { items: [], load: () => {}, getItem: () => mockPivot },
        worksheets: { getItem: () => ({}) },
      },
      sync: async () => {},
    };
    (globalThis as unknown as Record<string, unknown>).Excel = {
      AggregationFunction: { sum: 'Sum', count: 'Count', average: 'Average', max: 'Max', min: 'Min', product: 'Product' },
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(PIVOT_SPECS[3], handleAddPivotField);

    const r = await executor.execute(
      makeCall('add_pivot_field', { workbook_id: HOST_ID, name: 'SalesPivot', field: 'Region', area: 'row' }),
      SCOPE
    );
    expect(r.ok).toBe(true);
    expect(addedHierarchy).toBe(mockRegionHierarchy);
    expect((r.data as { area: string }).area).toBe('row');
  });

  it('returns ValidationError for invalid area', async () => {
    const mockPivot = {
      hierarchies: { items: [{ name: 'Region' }], load: () => {} },
      rowHierarchies: { add: () => {} },
    };
    const ctx = {
      workbook: {
        pivotTables: { items: [], load: () => {}, getItem: () => mockPivot },
        worksheets: { getItem: () => ({}) },
      },
      sync: async () => {},
    };
    (globalThis as unknown as Record<string, unknown>).Excel = {
      AggregationFunction: { sum: 'Sum' },
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(PIVOT_SPECS[3], handleAddPivotField);

    const r = await executor.execute(
      makeCall('add_pivot_field', { workbook_id: HOST_ID, name: 'SalesPivot', field: 'Region', area: 'invalid' }),
      SCOPE
    );
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('ValidationError');
  });

  it('returns ValidationError when field not found', async () => {
    const mockPivot = {
      hierarchies: { items: [{ name: 'Region' }], load: () => {} },
      rowHierarchies: { add: () => {} },
    };
    const ctx = {
      workbook: {
        pivotTables: { items: [], load: () => {}, getItem: () => mockPivot },
        worksheets: { getItem: () => ({}) },
      },
      sync: async () => {},
    };
    (globalThis as unknown as Record<string, unknown>).Excel = {
      AggregationFunction: { sum: 'Sum' },
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(PIVOT_SPECS[3], handleAddPivotField);

    const r = await executor.execute(
      makeCall('add_pivot_field', { workbook_id: HOST_ID, name: 'SalesPivot', field: 'NonExistent', area: 'row' }),
      SCOPE
    );
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('ValidationError');
    expect(r.error?.message).toMatch(/NonExistent/);
  });
});

// ── refresh_pivot ──────────────────────────────────────────────────────────

describe('refresh_pivot handler', () => {
  it('calls refresh on the pivot table', async () => {
    let refreshed = false;
    const mockPivot = { refresh: () => { refreshed = true; } };
    const ctx = {
      workbook: {
        pivotTables: { items: [], load: () => {}, getItem: () => mockPivot },
        worksheets: { getItem: () => ({}) },
      },
      sync: async () => {},
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(PIVOT_SPECS[4], handleRefreshPivot);

    const r = await executor.execute(makeCall('refresh_pivot', { workbook_id: HOST_ID, name: 'SalesPivot' }), SCOPE);
    expect(r.ok).toBe(true);
    expect(refreshed).toBe(true);
    expect((r.data as { refreshed: boolean }).refreshed).toBe(true);
  });
});
