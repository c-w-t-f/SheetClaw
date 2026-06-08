import type { ToolSpec } from '../../types';
import type { ToolHandler } from '../executor';
import { ToolUnsupportedError } from '../unsupported-error';

// ── Chart type allow-list ──────────────────────────────────────────────────

function getChartType(name: string): Excel.ChartType {
  switch (name.toLowerCase()) {
    case 'column':   return Excel.ChartType.columnClustered;
    case 'bar':      return Excel.ChartType.barClustered;
    case 'line':     return Excel.ChartType.line;
    case 'pie':      return Excel.ChartType.pie;
    case 'area':     return Excel.ChartType.area;
    case 'scatter':  return Excel.ChartType.xyscatter;
    case 'doughnut': return Excel.ChartType.doughnut;
    case 'radar':    return Excel.ChartType.radar;
    default: throw new ToolUnsupportedError(
      `Unsupported chart_type "${name}". Supported: column, bar, line, pie, area, scatter, doughnut, radar`
    );
  }
}

function getSeriesBy(val?: string): Excel.ChartSeriesBy {
  if (val === 'rows')    return Excel.ChartSeriesBy.rows;
  if (val === 'columns') return Excel.ChartSeriesBy.columns;
  return Excel.ChartSeriesBy.auto;
}

// ── Specs ──────────────────────────────────────────────────────────────────

export const LIST_CHARTS: ToolSpec = {
  name: 'list_charts',
  description: 'List all charts embedded in a worksheet, with their names and types.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
      sheet: { type: 'string', description: 'Worksheet name' },
    },
    required: ['workbook_id', 'sheet'],
  },
  mutating: false,
};

export const CREATE_CHART: ToolSpec = {
  name: 'create_chart',
  description: 'Create a new chart on a worksheet from a data range. Requires user confirmation. Supported chart_type values: column, bar, line, pie, area, scatter, doughnut, radar.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id:  { type: 'string', description: 'Workbook ID' },
      sheet:        { type: 'string', description: 'Worksheet name' },
      chart_type:   { type: 'string', description: 'Chart type: column, bar, line, pie, area, scatter, doughnut, radar' },
      data_range:   { type: 'string', description: 'A1 range address of the source data, e.g. "A1:C10"' },
      title:        { type: 'string', description: 'Optional chart title' },
      series_by:    { type: 'string', description: 'How to interpret data: "auto" (default), "rows", or "columns"' },
    },
    required: ['workbook_id', 'sheet', 'chart_type', 'data_range'],
  },
  mutating: true,
};

export const MODIFY_CHART: ToolSpec = {
  name: 'modify_chart',
  description: 'Modify properties of an existing chart: title, type, or data range. Requires user confirmation.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
      sheet:       { type: 'string', description: 'Worksheet name' },
      chart_name:  { type: 'string', description: 'Name of the chart to modify' },
      title:       { type: 'string', description: 'New chart title' },
      chart_type:  { type: 'string', description: 'New chart type (column, bar, line, pie, area, scatter, doughnut, radar)' },
      data_range:  { type: 'string', description: 'New source data range' },
      series_by:   { type: 'string', description: '"auto", "rows", or "columns"' },
    },
    required: ['workbook_id', 'sheet', 'chart_name'],
  },
  mutating: true,
};

export const DELETE_CHART: ToolSpec = {
  name: 'delete_chart',
  description: 'Delete a chart from a worksheet. Requires user confirmation.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
      sheet:       { type: 'string', description: 'Worksheet name' },
      chart_name:  { type: 'string', description: 'Name of the chart to delete' },
    },
    required: ['workbook_id', 'sheet', 'chart_name'],
  },
  mutating: true,
};

export const SET_CHART_DATA: ToolSpec = {
  name: 'set_chart_data',
  description: 'Change the source data range of an existing chart. Requires user confirmation.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
      sheet:       { type: 'string', description: 'Worksheet name' },
      chart_name:  { type: 'string', description: 'Name of the chart' },
      data_range:  { type: 'string', description: 'New source data range, e.g. "A1:C10"' },
      series_by:   { type: 'string', description: '"auto", "rows", or "columns"' },
    },
    required: ['workbook_id', 'sheet', 'chart_name', 'data_range'],
  },
  mutating: true,
};

export const CHART_SPECS: ToolSpec[] = [
  LIST_CHARTS, CREATE_CHART, MODIFY_CHART, DELETE_CHART, SET_CHART_DATA,
];

// ── Handlers ───────────────────────────────────────────────────────────────

export const handleListCharts: ToolHandler = async (args, ctx) => {
  const sheet = ctx.workbook.worksheets.getItem(args.sheet as string);
  const charts = sheet.charts;
  charts.load('items/name,items/chartType');
  await ctx.sync();
  return charts.items.map(c => ({ name: c.name, chartType: c.chartType }));
};

export const handleCreateChart: ToolHandler = async (args, ctx) => {
  const sheet = ctx.workbook.worksheets.getItem(args.sheet as string);
  const range = sheet.getRange(args.data_range as string);
  const chartType = getChartType(args.chart_type as string);
  const seriesBy = getSeriesBy(args.series_by as string | undefined);

  const chart = sheet.charts.add(chartType, range, seriesBy);
  if (args.title) {
    chart.title.text = args.title as string;
    chart.title.visible = true;
  }
  chart.load('name');
  await ctx.sync();
  return { name: chart.name, created: true };
};

export const handleModifyChart: ToolHandler = async (args, ctx) => {
  const sheet = ctx.workbook.worksheets.getItem(args.sheet as string);
  const chart = sheet.charts.getItem(args.chart_name as string);
  const applied: string[] = [];

  if (args.title !== undefined) {
    chart.title.text = args.title as string;
    chart.title.visible = true;
    applied.push('title');
  }
  if (args.chart_type !== undefined) {
    chart.chartType = getChartType(args.chart_type as string);
    applied.push('chartType');
  }
  if (args.data_range !== undefined) {
    const range = sheet.getRange(args.data_range as string);
    chart.setData(range, getSeriesBy(args.series_by as string | undefined));
    applied.push('dataRange');
  }
  await ctx.sync();
  return { name: args.chart_name, applied };
};

export const handleDeleteChart: ToolHandler = async (args, ctx) => {
  const sheet = ctx.workbook.worksheets.getItem(args.sheet as string);
  const chart = sheet.charts.getItem(args.chart_name as string);
  chart.delete();
  await ctx.sync();
  return { deleted: true, name: args.chart_name };
};

export const handleSetChartData: ToolHandler = async (args, ctx) => {
  const sheet = ctx.workbook.worksheets.getItem(args.sheet as string);
  const chart = sheet.charts.getItem(args.chart_name as string);
  const range = sheet.getRange(args.data_range as string);
  chart.setData(range, getSeriesBy(args.series_by as string | undefined));
  await ctx.sync();
  return { name: args.chart_name, dataRange: args.data_range };
};
