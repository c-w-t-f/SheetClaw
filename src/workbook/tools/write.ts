import type { ToolSpec } from '../../types';
import type { ToolHandler } from '../executor';
import { ToolValidationError } from '../executor';

// ── Specs ──────────────────────────────────────────────────────────────────

export const WRITE_RANGE: ToolSpec = {
  name: 'write_range',
  description: 'Write values or formulas into a cell range. The 2D values array dimensions must exactly match the address. Requires user confirmation before applying.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
      sheet: { type: 'string', description: 'Worksheet name' },
      address: { type: 'string', description: 'A1 range address matching the values array dimensions' },
      values: { type: 'array', items: { type: 'array', items: { description: 'Cell value: string, number, boolean, null, or formula string starting with =' } }, description: 'Row-major 2D array of cell values' },
      as_text: { type: 'boolean', description: 'Force all values to literal text, skipping formula detection. Default: false' },
    },
    required: ['workbook_id', 'sheet', 'address', 'values'],
  },
  mutating: true,
};

export const CLEAR_RANGE: ToolSpec = {
  name: 'clear_range',
  description: 'Clear contents and/or formats of a range. Requires user confirmation before applying.',
  parameters: {
    type: 'object',
    properties: {
      workbook_id: { type: 'string', description: 'Workbook ID' },
      sheet: { type: 'string', description: 'Worksheet name' },
      address: { type: 'string', description: 'A1 range address' },
      apply_to: { type: 'string', description: '"contents" (default), "formats", or "all"' },
    },
    required: ['workbook_id', 'sheet', 'address'],
  },
  mutating: true,
};

export const WRITE_SPECS: ToolSpec[] = [WRITE_RANGE, CLEAR_RANGE];

// ── Handlers ───────────────────────────────────────────────────────────────
// These run after the snapshot is captured and the user has confirmed.
// They just perform the write — no snapshot or confirmation logic here.

export const handleWriteRange: ToolHandler = async (args, ctx) => {
  const sheet = args.sheet as string;
  const address = args.address as string;
  const values = args.values as (string | number | boolean | null)[][];
  const asText = (args.as_text as boolean | undefined) ?? false;

  if (!Array.isArray(values) || !values.every(r => Array.isArray(r))) {
    throw new ToolValidationError('"values" must be a 2D array');
  }

  const range = ctx.workbook.worksheets.getItem(sheet).getRange(address);
  range.load('rowCount,columnCount');
  await ctx.sync();

  if (range.rowCount !== values.length || range.columnCount !== (values[0]?.length ?? 0)) {
    throw new ToolValidationError(
      `Dimension mismatch: range ${address} is ${range.rowCount}×${range.columnCount} ` +
      `but values are ${values.length}×${values[0]?.length ?? 0}. Adjust address or values.`
    );
  }

  if (asText) {
    range.values = values as (string | number | boolean)[][];
  } else {
    // formulas handles both formula strings (=SUM…) and plain values
    range.formulas = values.map(row =>
      row.map(v => (v === null || v === undefined ? '' : v))
    ) as (string | number | boolean)[][];
  }
  await ctx.sync();

  return { address, written: { rows: range.rowCount, cols: range.columnCount } };
};

export const handleClearRange: ToolHandler = async (args, ctx) => {
  const sheet = args.sheet as string;
  const address = args.address as string;
  const applyTo = (args.apply_to as string | undefined) ?? 'contents';

  const clearType =
    applyTo === 'formats' ? Excel.ClearApplyTo.formats :
    applyTo === 'all' ? Excel.ClearApplyTo.all :
    Excel.ClearApplyTo.contents;

  const range = ctx.workbook.worksheets.getItem(sheet).getRange(address);
  range.clear(clearType);
  await ctx.sync();

  return { address, cleared: applyTo };
};
