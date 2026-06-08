export { WorkbookRegistry, WorkbookNotFoundError } from './registry';
export type { ExcelRunner } from './registry';
export { ToolExecutor, ToolValidationError } from './executor';
export type { ToolHandler } from './executor';
export { PHASE4_READ_SPECS } from './tools/specs';

import { WorkbookRegistry } from './registry';
import { ToolExecutor } from './executor';
import type { ToolSpec } from '../types';
import type { ToolHandler } from './executor';
import { PHASE4_READ_SPECS } from './tools/specs';
import {
  handleReadRange,
  handleListSheets,
  handleGetSheetContext,
  handleGetSelection,
} from './tools/range';
import {
  handleListWorkbooks,
  handleGetActiveWorkbook,
  handleSetScopeWorkbook,
  handleGetNamedRanges,
} from './tools/workbook_tools';

// ── Factory ────────────────────────────────────────────────────────────────
// Creates a pre-wired WorkbookRegistry + ToolExecutor for Phase 4 read tools.
// Caller must call registry.refresh() once on add-in startup.

export function createWorkbookLayer(): { registry: WorkbookRegistry; executor: ToolExecutor } {
  const registry = new WorkbookRegistry();
  const executor = new ToolExecutor(registry);

  const registrations: [ToolSpec, ToolHandler][] = [
    [PHASE4_READ_SPECS[0], handleReadRange],
    [PHASE4_READ_SPECS[1], handleListSheets],
    [PHASE4_READ_SPECS[2], handleGetSheetContext],
    [PHASE4_READ_SPECS[3], handleGetSelection],
    [PHASE4_READ_SPECS[4], handleListWorkbooks],
    [PHASE4_READ_SPECS[5], handleGetActiveWorkbook],
    [PHASE4_READ_SPECS[6], handleSetScopeWorkbook],
    [PHASE4_READ_SPECS[7], handleGetNamedRanges],
  ];

  for (const [spec, handler] of registrations) {
    executor.register(spec, handler);
  }

  return { registry, executor };
}
