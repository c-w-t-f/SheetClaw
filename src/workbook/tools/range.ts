import type { ToolHandler } from '../executor';
import { ToolValidationError } from '../executor';

const MAX_CELLS = 10_000;

// ── read_range ─────────────────────────────────────────────────────────────

export const handleReadRange: ToolHandler = async (args, ctx) => {
  const sheet = args.sheet as string;
  const address = args.address as string;
  const include = (args.include as string[] | undefined) ?? ['values'];

  const ws = ctx.workbook.worksheets.getItem(sheet);
  const range = ws.getRange(address);
  range.load(['rowCount', 'columnCount', 'address', ...include].join(','));
  await ctx.sync();

  const cells = range.rowCount * range.columnCount;
  if (cells > MAX_CELLS) {
    throw new ToolValidationError(
      `Range is too large (${cells} cells, max ${MAX_CELLS}). Narrow the address and try again.`
    );
  }

  const result: Record<string, unknown> = {
    address: range.address,
    rowCount: range.rowCount,
    colCount: range.columnCount,
  };
  if (include.includes('values')) result.values = range.values as unknown[][];
  if (include.includes('formulas')) result.formulas = range.formulas as unknown[][];
  if (include.includes('numberFormat')) result.numberFormat = range.numberFormat as string[][];
  if (include.includes('text')) result.text = range.text as string[][];

  return result;
};

// ── list_sheets ────────────────────────────────────────────────────────────

export const handleListSheets: ToolHandler = async (_args, ctx) => {
  ctx.workbook.worksheets.load('items/name,items/position,items/visibility');
  await ctx.sync();

  return ctx.workbook.worksheets.items.map(ws => ({
    name: ws.name,
    position: ws.position,
    visible: ws.visibility === Excel.SheetVisibility.visible,
  }));
};

// ── get_sheet_context ──────────────────────────────────────────────────────

export const handleGetSheetContext: ToolHandler = async (args, ctx) => {
  const sheet = args.sheet as string;
  const sampleRows = Math.min((args.sample_rows as number | undefined) ?? 5, 20);

  const ws = ctx.workbook.worksheets.getItem(sheet);
  const used = ws.getUsedRangeOrNullObject();
  used.load('address,rowCount,columnCount,rowIndex,columnIndex,isNullObject');
  await ctx.sync();

  if (used.isNullObject) {
    return { usedRange: null, headers: null, sampleValues: [] };
  }

  const rowCount = Math.min(sampleRows + 1, used.rowCount);
  const sample = ws.getRangeByIndexes(used.rowIndex, used.columnIndex, rowCount, used.columnCount);
  sample.load('values');
  await ctx.sync();

  const rows = sample.values as unknown[][];
  return {
    usedRange: { address: used.address, rowCount: used.rowCount, colCount: used.columnCount },
    headers: rows[0] ?? null,
    sampleValues: rows.slice(1),
  };
};

// ── get_selection ──────────────────────────────────────────────────────────

export const handleGetSelection: ToolHandler = async (_args, ctx) => {
  const sel = ctx.workbook.getSelectedRange();
  sel.load('address,worksheet/name,values,rowCount,columnCount');
  await ctx.sync();

  return {
    sheet: sel.worksheet.name,
    address: sel.address,
    rowCount: sel.rowCount,
    colCount: sel.columnCount,
    values: sel.values as unknown[][],
  };
};
