import type { ToolHandler } from '../executor';

// ── list_workbooks ─────────────────────────────────────────────────────────

export const handleListWorkbooks: ToolHandler = async (_args, _ctx, registry) => {
  return registry.getManifest();
};

// ── get_active_workbook ────────────────────────────────────────────────────

export const handleGetActiveWorkbook: ToolHandler = async (_args, _ctx, registry) => {
  const manifest = registry.getManifest();
  const active = manifest.workbooks.find(w => w.workbookId === manifest.active);
  if (!active) return { workbook_id: null, name: null };
  return { workbook_id: active.workbookId, name: active.name };
};

// ── set_scope_workbook ─────────────────────────────────────────────────────
// workbook_id is already validated by executor before this runs

export const handleSetScopeWorkbook: ToolHandler = async (args, _ctx, registry) => {
  const id = args.workbook_id as string;
  registry.setActive(id);
  return { workbook_id: id };
};

// ── get_named_ranges ───────────────────────────────────────────────────────

export const handleGetNamedRanges: ToolHandler = async (_args, ctx) => {
  ctx.workbook.names.load('items/name,items/formula,items/type,items/scope,items/comment');
  await ctx.sync();

  return ctx.workbook.names.items.map(n => ({
    name: n.name,
    refersTo: n.formula,
    type: n.type,
    scope: n.scope,
    comment: n.comment ?? undefined,
  }));
};
