import { describe, it, expect } from 'vitest';
import { WorkbookRegistry } from '../registry';
import { ToolExecutor } from '../executor';
import { ToolUnsupportedError } from '../unsupported-error';
import type { ExcelRunner } from '../registry';
import type { ToolCall } from '../../types';
import {
  CHART_SPECS,
  handleListCharts,
  handleCreateChart,
  handleModifyChart,
  handleDeleteChart,
  handleSetChartData,
} from '../tools/charts';

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

// ── list_charts ────────────────────────────────────────────────────────────

describe('list_charts handler', () => {
  it('returns chart names and types', async () => {
    const mockCharts = {
      items: [
        { name: 'SalesChart', chartType: 'ColumnClustered' },
        { name: 'TrendLine', chartType: 'Line' },
      ],
      load: () => {},
    };
    const ctx = {
      workbook: { worksheets: { getItem: () => ({ charts: mockCharts }) } },
      sync: async () => {},
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(CHART_SPECS[0], handleListCharts);

    const r = await executor.execute(makeCall('list_charts', { workbook_id: HOST_ID, sheet: 'Sheet1' }), SCOPE);
    expect(r.ok).toBe(true);
    const data = r.data as Array<{ name: string; chartType: string }>;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ name: 'SalesChart', chartType: 'ColumnClustered' });
    expect(data[1]).toMatchObject({ name: 'TrendLine', chartType: 'Line' });
  });

  it('returns empty array when no charts', async () => {
    const mockCharts = { items: [], load: () => {} };
    const ctx = {
      workbook: { worksheets: { getItem: () => ({ charts: mockCharts }) } },
      sync: async () => {},
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(CHART_SPECS[0], handleListCharts);

    const r = await executor.execute(makeCall('list_charts', { workbook_id: HOST_ID, sheet: 'Sheet1' }), SCOPE);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });
});

// ── create_chart ───────────────────────────────────────────────────────────

describe('create_chart handler', () => {
  it('creates a chart and returns its name', async () => {
    const mockChart = { name: 'Chart 1', title: { text: '', visible: false }, load: () => {} };
    const mockCharts = { add: () => mockChart };
    const ctx = {
      workbook: { worksheets: { getItem: () => ({ charts: mockCharts, getRange: () => ({}) }) } },
      sync: async () => {},
    };
    // Stub Excel enums
    (globalThis as unknown as Record<string, unknown>).Excel = {
      ChartType: { columnClustered: 'ColumnClustered', barClustered: 'BarClustered', line: 'Line', pie: 'Pie', area: 'Area', xyscatter: 'XYScatter', doughnut: 'Doughnut', radar: 'Radar' },
      ChartSeriesBy: { auto: 'Auto', rows: 'Rows', columns: 'Columns' },
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(CHART_SPECS[1], handleCreateChart);

    const r = await executor.execute(
      makeCall('create_chart', { workbook_id: HOST_ID, sheet: 'Sheet1', chart_type: 'column', data_range: 'A1:C10' }),
      SCOPE
    );
    expect(r.ok).toBe(true);
    expect((r.data as { name: string }).name).toBe('Chart 1');
  });

  it('rejects unsupported chart_type with Unsupported error', async () => {
    (globalThis as unknown as Record<string, unknown>).Excel = {
      ChartType: {},
      ChartSeriesBy: { auto: 'Auto' },
    };

    // Test the handler directly — verify it throws ToolUnsupportedError
    let caughtError: Error | undefined;
    try {
      const fakeCtx = {
        workbook: { worksheets: { getItem: () => ({ getRange: () => ({}) }) } },
        sync: async () => {},
      };
      await handleCreateChart(
        { workbook_id: HOST_ID, sheet: 'Sheet1', chart_type: 'waterfall', data_range: 'A1:C10' },
        fakeCtx as unknown as Excel.RequestContext,
        makeRegistry()
      );
    } catch (e) {
      caughtError = e as Error;
    }
    expect(caughtError).toBeDefined();
    expect(caughtError instanceof ToolUnsupportedError).toBe(true);
    expect(caughtError?.name).toBe('ToolUnsupportedError');
    expect(caughtError?.message).toMatch(/waterfall/);
  });

  it('sets chart title when provided', async () => {
    const mockChart = { name: 'MyChart', title: { text: '', visible: false }, load: () => {} };
    const ctx = {
      workbook: { worksheets: { getItem: () => ({ charts: { add: () => mockChart }, getRange: () => ({}) }) } },
      sync: async () => {},
    };
    (globalThis as unknown as Record<string, unknown>).Excel = {
      ChartType: { columnClustered: 'ColumnClustered' },
      ChartSeriesBy: { auto: 'Auto' },
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(CHART_SPECS[1], handleCreateChart);

    await executor.execute(
      makeCall('create_chart', { workbook_id: HOST_ID, sheet: 'Sheet1', chart_type: 'column', data_range: 'A1:C5', title: 'Sales 2024' }),
      SCOPE
    );
    expect(mockChart.title.text).toBe('Sales 2024');
    expect(mockChart.title.visible).toBe(true);
  });
});

// ── modify_chart ───────────────────────────────────────────────────────────

describe('modify_chart handler', () => {
  it('applies title change and reports applied fields', async () => {
    const mockChart = {
      chartType: 'ColumnClustered',
      title: { text: '', visible: false },
      setData: () => {},
    };
    const ctx = {
      workbook: { worksheets: { getItem: () => ({ charts: { getItem: () => mockChart }, getRange: () => ({}) }) } },
      sync: async () => {},
    };
    (globalThis as unknown as Record<string, unknown>).Excel = {
      ChartType: { columnClustered: 'ColumnClustered' },
      ChartSeriesBy: { auto: 'Auto' },
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(CHART_SPECS[2], handleModifyChart);

    const r = await executor.execute(
      makeCall('modify_chart', { workbook_id: HOST_ID, sheet: 'Sheet1', chart_name: 'SalesChart', title: 'Q1 Sales' }),
      SCOPE
    );
    expect(r.ok).toBe(true);
    const data = r.data as { name: string; applied: string[] };
    expect(data.applied).toContain('title');
    expect(mockChart.title.text).toBe('Q1 Sales');
  });
});

// ── delete_chart ───────────────────────────────────────────────────────────

describe('delete_chart handler', () => {
  it('deletes the named chart', async () => {
    let deleted = false;
    const mockChart = { delete: () => { deleted = true; } };
    const ctx = {
      workbook: { worksheets: { getItem: () => ({ charts: { getItem: () => mockChart } }) } },
      sync: async () => {},
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(CHART_SPECS[3], handleDeleteChart);

    const r = await executor.execute(
      makeCall('delete_chart', { workbook_id: HOST_ID, sheet: 'Sheet1', chart_name: 'OldChart' }),
      SCOPE
    );
    expect(r.ok).toBe(true);
    expect(deleted).toBe(true);
    expect((r.data as { deleted: boolean }).deleted).toBe(true);
  });
});

// ── set_chart_data ─────────────────────────────────────────────────────────

describe('set_chart_data handler', () => {
  it('calls setData on the chart', async () => {
    let setDataCalled = false;
    const mockChart = { setData: () => { setDataCalled = true; } };
    const ctx = {
      workbook: { worksheets: { getItem: () => ({ charts: { getItem: () => mockChart }, getRange: () => ({}) }) } },
      sync: async () => {},
    };
    (globalThis as unknown as Record<string, unknown>).Excel = {
      ChartSeriesBy: { auto: 'Auto' },
    };

    const registry = makeRegistry();
    const executor = new ToolExecutor(registry, makeRunner(ctx));
    executor.register(CHART_SPECS[4], handleSetChartData);

    const r = await executor.execute(
      makeCall('set_chart_data', { workbook_id: HOST_ID, sheet: 'Sheet1', chart_name: 'SalesChart', data_range: 'A1:D20' }),
      SCOPE
    );
    expect(r.ok).toBe(true);
    expect(setDataCalled).toBe(true);
  });
});
