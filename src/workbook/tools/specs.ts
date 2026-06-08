import type { ToolSpec } from '../../types';

export const READ_RANGE: ToolSpec = {
  name: 'read_range',
  description: 'Read the values, formulas, and formatting of a cell range from a worksheet. Use before editing to understand current contents.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID from list_workbooks or get_active_workbook' },
      sheet: { type: 'string', description: 'Worksheet name' },
      address: { type: 'string', description: 'A1 range address, e.g. "A1:D10"' },
      include: { type: 'array', items: { type: 'string', enum: ['values', 'formulas', 'numberFormat', 'text'] }, description: 'Which data to return. Default: ["values"]' },
    },
    required: ['workbook_id', 'sheet', 'address'],
  },
  mutating: false,
};

export const LIST_SHEETS: ToolSpec = {
  name: 'list_sheets',
  description: 'List all worksheets in a workbook with their names, positions, and visibility.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
    },
    required: ['workbook_id'],
  },
  mutating: false,
};

export const GET_SHEET_CONTEXT: ToolSpec = {
  name: 'get_sheet_context',
  description: 'Get the used range bounds, header row, and a sample of data rows from a worksheet. Use to understand sheet structure before reading or writing.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
      sheet: { type: 'string', description: 'Worksheet name' },
      sample_rows: { type: 'number', description: 'Number of data rows to sample (default 5, max 20)' },
    },
    required: ['workbook_id', 'sheet'],
  },
  mutating: false,
};

export const GET_SELECTION: ToolSpec = {
  name: 'get_selection',
  description: 'Get the currently selected range in the workbook, including sheet name, address, and values.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
    },
    required: ['workbook_id'],
  },
  mutating: false,
};

export const LIST_WORKBOOKS: ToolSpec = {
  name: 'list_workbooks',
  description: 'List all open workbooks. In the current environment this returns the host workbook only.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  mutating: false,
};

export const GET_ACTIVE_WORKBOOK: ToolSpec = {
  name: 'get_active_workbook',
  description: 'Get the active workbook ID and name. Use this to get the workbook_id needed by other tools.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  mutating: false,
};

export const SET_SCOPE_WORKBOOK: ToolSpec = {
  name: 'set_scope_workbook',
  description: 'Set which workbook subsequent operations target.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID to target' },
    },
    required: ['workbook_id'],
  },
  mutating: false,
};

export const GET_NAMED_RANGES: ToolSpec = {
  name: 'get_named_ranges',
  description: 'List all named ranges and named formulas defined in the workbook.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
    },
    required: ['workbook_id'],
  },
  mutating: false,
};

export const PHASE4_READ_SPECS: ToolSpec[] = [
  READ_RANGE,
  LIST_SHEETS,
  GET_SHEET_CONTEXT,
  GET_SELECTION,
  LIST_WORKBOOKS,
  GET_ACTIVE_WORKBOOK,
  SET_SCOPE_WORKBOOK,
  GET_NAMED_RANGES,
];
