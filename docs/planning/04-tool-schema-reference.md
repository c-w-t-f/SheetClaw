# Document 4 — Tool Schema Reference

Every tool the agent can call. All tools take `workbook_id` (required) so the agent can operate across open workbooks (degrades to host workbook per [D8]). Sheet is addressed by `sheet` name. Ranges use A1 notation.

Conventions for parameter tables: **T** = type, **R** = required. Constraints inline.

Mutating tools (marked 🔒) trigger snapshot-before-write and the confirmation gate.

---

## 4.1 Range operations

### `read_range` 
**Description (LLM-facing):** "Read the values, formulas, and formatting of a cell range from a worksheet. Use before editing to understand current contents."

| Param | T | R | Constraints |
|-------|---|---|-------------|
| workbook_id | string | ✓ | Must exist in registry |
| sheet | string | ✓ | Existing sheet name |
| address | string | ✓ | A1 range, ≤ configured max cells (default 10k) |
| include | string[] | ✗ | subset of `["values","formulas","numberFormat","text"]`; default `["values"]` |

**Returns:** `{ address, rowCount, colCount, values?, formulas?, numberFormat?, text? }`
**Office.js:** `sheet.getRange(address); range.load("values,formulas,numberFormat,text,rowCount,columnCount"); ctx.sync()`
**Edge cases:** entire-column refs (`A:A`) → clamp to used range; merged cells return value in top-left; volatile formulas. **Safety:** read-only; large reads capped to protect context budget.

### `write_range` 🔒
**Description:** "Write values or formulas into a cell range. The 2D array dimensions must match the address. Requires user confirmation."

| Param | T | R | Constraints |
|-------|---|---|-------------|
| workbook_id | string | ✓ | |
| sheet | string | ✓ | |
| address | string | ✓ | A1 range matching `values` dims |
| values | (string\|number\|boolean\|null)[][] | ✓ | row-major; cells starting with `=` treated as formulas unless `as_text` |
| as_text | boolean | ✗ | force literal text (no formula parsing); default false |

**Returns:** `{ address, written: {rows, cols} }`
**Office.js:** `range.values = values` (or `range.formulas`); `ctx.sync()`. Dimension mismatch throws.
**Edge cases:** dim mismatch → ValidationError (fed back to model); writing into a spill/array-formula region; protected sheet → OfficeApiError. **Safety:** snapshot of `address` before write; per-cell diff in ConfirmationModal.

### `clear_range` 🔒
**Description:** "Clear contents and/or formats of a range."
| Param | T | R | Constraints |
|---|---|---|---|
| workbook_id | string | ✓ | |
| sheet | string | ✓ | |
| address | string | ✓ | |
| apply_to | string | ✗ | `"contents"`(default)\|`"formats"`\|`"all"` |

**Returns:** `{ address, cleared: apply_to }` · **Office.js:** `range.clear(Excel.ClearApplyTo.*)` · **Safety:** snapshot before; diff shows → empty.

### `format_range` 🔒
**Description:** "Apply formatting (number format, font, fill, borders, alignment) to a range."
| Param | T | R | Constraints |
|---|---|---|---|
| workbook_id, sheet, address | string | ✓ | |
| numberFormat | string | ✗ | e.g. `"#,##0.00"`, `"0%"` |
| font | object | ✗ | `{bold?,italic?,color?,size?,name?}` |
| fill | string | ✗ | hex color |
| borders | object | ✗ | edge→style map |
| alignment | object | ✗ | `{horizontal?,vertical?,wrapText?}` |

**Returns:** `{ address, applied: string[] }` · **Office.js:** `range.format.*`, `range.numberFormat` · **Safety:** snapshot includes prior format; diff is format-level (elevated detail).

### `find_replace` 🔒
**Description:** "Find and replace text within a range or sheet."
| Param | T | R | Constraints |
|---|---|---|---|
| workbook_id, sheet | string | ✓ | |
| find | string | ✓ | |
| replace | string | ✓ | |
| address | string | ✗ | default whole used range |
| match_case, match_whole | boolean | ✗ | |

**Returns:** `{ replacements: number }` · **Office.js:** `range.replaceAll(find, replace, {matchCase, completeMatch})` · **Edge:** large replace counts; **Safety:** snapshot affected range (or whole used range) before; confirmation shows count + sample diffs.

### `sort_range` / `autofill_range` / `set_formula` 🔒
- `sort_range`: params `{workbook_id, sheet, address, key_columns:[{index, order}], has_headers?}` → `range.sort.apply(...)`.
- `autofill_range`: params `{workbook_id, sheet, source, destination, fill_type?}` → `sourceRange.autoFill(destination, type)`.
- `set_formula`: convenience over `write_range` for a single formula across a range; `{workbook_id, sheet, address, formula}` → `range.formulas`.
All 🔒 with snapshot + confirmation.

---

## 4.2 Sheet operations

| Tool | Mut | Params | Returns | Office.js | Notes/Safety |
|------|-----|--------|---------|-----------|--------------|
| `list_sheets` | | `{workbook_id}` | `[{name,position,visible,usedRange}]` | `workbook.worksheets.load("name,position,visibility")` | read-only |
| `get_sheet_context` | | `{workbook_id, sheet, sample_rows?}` | `{usedRange, headers, sampleValues, selection}` | used range + sample load | feeds ContextBuilder |
| `add_sheet` 🔒 | ✓ | `{workbook_id, name, position?}` | `{name, position}` | `worksheets.add(name)` | name collision → ValidationError; snapshot = sheet existence (undo deletes) |
| `delete_sheet` 🔒 | ✓ | `{workbook_id, name}` | `{deleted:name}` | `sheet.delete()` | **elevated** — destructive; snapshot serializes sheet contents best-effort; cannot delete last visible sheet |
| `rename_sheet` 🔒 | ✓ | `{workbook_id, from, to}` | `{from,to}` | `sheet.name = to` | name collision/invalid chars |
| `set_sheet_visibility` 🔒 | ✓ | `{workbook_id, name, visibility}` | `{name,visibility}` | `sheet.visibility` | hidden/veryHidden |
| `set_active_sheet` | | `{workbook_id, name}` | `{active:name}` | `sheet.activate()` | non-mutating (view only) |

---

## 4.3 Workbook operations

| Tool | Mut | Params | Returns | Office.js | Notes |
|------|-----|--------|---------|-----------|-------|
| `list_workbooks` | | `{}` | `WorkbookManifest` | registry | enumerates open workbooks; degrade to host-only [D8] |
| `get_active_workbook` | | `{}` | `{workbook_id, name}` | registry | the session scope |
| `set_scope_workbook` | | `{workbook_id}` | `{workbook_id}` | registry.setActive | re-scopes session target (mirrors WorkbookSwitcher) |
| `get_selection` | | `{workbook_id}` | `{sheet, address, values}` | `workbook.getSelectedRange()` | read-only |
| `get_named_ranges` | | `{workbook_id}` | `[{name, refersTo, scope}]` | `workbook.names.load` | read-only |
| `add_named_range` 🔒 | ✓ | `{workbook_id, name, refersTo, scope?}` | `{name}` | `names.add(name, range)` | collision check |

> **Cross-workbook caution (Risk R5):** every workbook tool resolves `workbook_id` through the registry; the confirmation modal always labels the target workbook name to prevent wrong-workbook writes.

---

## 4.4 Chart operations  (Office.js charts are non-trivial — Risk R6)

| Tool | Mut | Params (key) | Returns | Office.js | Notes/Safety |
|------|-----|--------------|---------|-----------|--------------|
| `list_charts` | | `{workbook_id, sheet}` | `[{name, type, dataRange?}]` | `sheet.charts.load("name,chartType")` | read-only |
| `create_chart` 🔒 | ✓ | `{workbook_id, sheet, chart_type, data_range, position?, title?}` | `{name}` | `sheet.charts.add(type, range, seriesBy)` | **elevated** confirmation; `chart_type` constrained to `Excel.ChartType` enum subset; snapshot = "created chart name" (undo deletes) |
| `modify_chart` 🔒 | ✓ | `{workbook_id, sheet, chart_name, title?, axes?, legend?, data_range?, chart_type?}` | `{name, applied[]}` | `chart.title/legend/axes/...` | snapshot serializes prior chart definition (best-effort → `structural-coarse` undo) |
| `delete_chart` 🔒 | ✓ | `{workbook_id, sheet, chart_name}` | `{deleted}` | `chart.delete()` | snapshot best-effort definition |
| `set_chart_data` 🔒 | ✓ | `{workbook_id, sheet, chart_name, data_range, series_by?}` | `{name}` | `chart.setData(range, seriesBy)` | |

**Chart edge/failure modes:** `chartType` string must map to the exact Office enum (validate + suggest); some properties are read-only or version-gated; setting a data range with mismatched orientation; charts on chart-sheets vs embedded. Tool layer keeps an allow-list of supported chart types and properties and returns a `Unsupported` ToolResult for the rest so the model can adapt.

---

## 4.5 Pivot table operations  **[DECISION REQUIRED D5: full vs limited scope]**

Office.js PivotTable API is **less mature** than ranges/charts and varies by Excel build. Scope decision pending; spec below is the *target* full set, with a documented minimum viable subset.

| Tool | Mut | Params (key) | Returns | Office.js | Notes |
|------|-----|--------------|---------|-----------|-------|
| `list_pivots` | | `{workbook_id, sheet?}` | `[{name, location, sourceRange?}]` | `sheet.pivotTables.load` | read-only (MVP) |
| `get_pivot` | | `{workbook_id, name}` | `{rows, columns, values, filters, sourceRange}` | hierarchies load | read-only (MVP) |
| `create_pivot` 🔒 | ✓ | `{workbook_id, source_range, destination, name?}` | `{name}` | `worksheet.pivotTables.add(name, source, dest)` | **elevated**; snapshot = created table (undo deletes) — **MVP candidate** |
| `add_pivot_field` 🔒 | ✓ | `{workbook_id, name, field, area, function?}` | `{name, field, area}` | `pivot.rowHierarchies/columnHierarchies/dataHierarchies.add(...)` | area ∈ row/column/data/filter; function for data area |
| `remove_pivot_field` 🔒 | ✓ | `{workbook_id, name, field, area}` | `{name}` | `*.remove(...)` | |
| `refresh_pivot` 🔒 | ✓ | `{workbook_id, name}` | `{name, refreshed:true}` | `pivot.refresh()` | low risk |
| `delete_pivot` 🔒 | ✓ | `{workbook_id, name}` | `{deleted}` | `pivot.delete()` | snapshot best-effort |

**Minimum viable subset (recommended for first ship):** `list_pivots`, `get_pivot`, `create_pivot`, `add_pivot_field`, `refresh_pivot`. Full field manipulation gated behind capability detection. **Pivot edge cases:** layout/compact mode differences, calculated fields unsupported via API, source-range changes require recreate, refresh on external data. Pivot undo is `structural-coarse`.

---

## 4.6 Tool definition serialization (provider formats) and translation point

Tools are authored **once** as internal `ToolSpec` (name, description, JSON-Schema parameters, `mutating` flag). Adapters serialize per provider. **Translation happens inside each LLMClient adapter** (Doc 2 §2.1), never in AgentLoop or ToolExecutor — the loop is provider-agnostic.

### Internal `ToolSpec`
```ts
interface ToolSpec {
  name: string;
  description: string;
  parameters: JSONSchema;   // standard JSON Schema (object, properties, required)
  mutating: boolean;        // internal only; not serialized to providers
}
```

### OpenAI / Generic / Ollama (OpenAI-compatible) format
```json
{
  "type": "function",
  "function": {
    "name": "write_range",
    "description": "...",
    "parameters": { "type": "object", "properties": { ... }, "required": [ ... ] }
  }
}
```
Tool *calls* arrive as `message.tool_calls[] = { id, type:"function", function:{ name, arguments:"<json string>" } }`. Arguments stream as fragments → the adapter reassembles per `index` before parsing.

### Anthropic format
```json
{
  "name": "write_range",
  "description": "...",
  "input_schema": { "type": "object", "properties": { ... }, "required": [ ... ] }
}
```
Tool *calls* arrive as content blocks `{ type:"tool_use", id, name, input:{...} }` (input is a parsed object assembled from `input_json_delta` events). Tool *results* are sent back as a user message containing `{ type:"tool_result", tool_use_id, content }`.

### Translation responsibilities (per adapter)
| Aspect | OpenAI/Generic/Ollama | Anthropic |
|--------|------------------------|-----------|
| Tool list key | `tools[].function.parameters` | `tools[].input_schema` |
| Call extraction | `tool_calls[].function.{name,arguments(str)}` | `content[] type:tool_use {name,input(obj)}` |
| Arg type | JSON string (reassemble + `JSON.parse`) | object (assembled from json deltas) |
| Result feedback | `role:"tool", tool_call_id, content` message | `role:"user"` with `tool_result` block, `tool_use_id` |
| System prompt | first `role:"system"` message | top-level `system` param |
| Usage location | final `usage` chunk | `message_start` + `message_delta` usage |

The adapter exposes the normalized `LLMStreamEvent` stream (Doc 2) so AgentLoop's tool-call handling is identical regardless of provider. The divergence (Risk R2) is fully contained here and is the highest-value unit-test target (Doc 10 harness gate).
