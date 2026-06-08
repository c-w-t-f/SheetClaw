import type { ToolCall, ToolResult, ToolSpec, SessionScope } from '../types';
import { WorkbookRegistry, WorkbookNotFoundError } from './registry';
import type { ExcelRunner } from './registry';

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: Excel.RequestContext,
  registry: WorkbookRegistry
) => Promise<unknown>;

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

// ── Lightweight arg validation ─────────────────────────────────────────────
// Checks required fields + basic scalar types. Not full JSON Schema — enough
// to give the model a correctable error without a validator library.

function validateArgs(args: Record<string, unknown>, spec: ToolSpec): string | null {
  for (const field of spec.parameters.required ?? []) {
    if (args[field] === undefined || args[field] === null) {
      return `Missing required argument: "${field}"`;
    }
  }
  for (const [key, prop] of Object.entries(spec.parameters.properties)) {
    if (!(key in args)) continue;
    const v = args[key];
    if (!('type' in prop)) continue;
    const t = prop.type;
    if (t === 'string' && typeof v !== 'string') return `"${key}" must be a string`;
    if (t === 'number' && typeof v !== 'number') return `"${key}" must be a number`;
    if (t === 'boolean' && typeof v !== 'boolean') return `"${key}" must be a boolean`;
    if (t === 'array' && !Array.isArray(v)) return `"${key}" must be an array`;
  }
  return null;
}

// ── ToolExecutor ───────────────────────────────────────────────────────────

export class ToolExecutor {
  private tools = new Map<string, { spec: ToolSpec; handler: ToolHandler }>();

  constructor(
    private registry: WorkbookRegistry,
    private runner: ExcelRunner = fn => Excel.run(fn)
  ) {}

  register(spec: ToolSpec, handler: ToolHandler): void {
    this.tools.set(spec.name, { spec, handler });
  }

  getToolSpecs(): ToolSpec[] {
    return Array.from(this.tools.values()).map(e => e.spec);
  }

  async execute(call: ToolCall, _scope: SessionScope): Promise<ToolResult> {
    const entry = this.tools.get(call.name);
    if (!entry) {
      return err(call.id, 'ValidationError', `Unknown tool: "${call.name}"`);
    }

    const argError = validateArgs(call.arguments, entry.spec);
    if (argError) return err(call.id, 'ValidationError', argError);

    // Validate workbook_id against registry when the tool carries one
    if ('workbook_id' in call.arguments) {
      try {
        this.registry.resolve(call.arguments.workbook_id as string);
      } catch (e) {
        if (e instanceof WorkbookNotFoundError) {
          return err(call.id, 'WorkbookNotFound', e.message);
        }
        throw e;
      }
    }

    const start = Date.now();
    try {
      const data = await this.runner(ctx => entry.handler(call.arguments, ctx, this.registry));
      return { toolCallId: call.id, ok: true, data, durationMs: Date.now() - start };
    } catch (e) {
      if (e instanceof ToolValidationError) {
        return err(call.id, 'ValidationError', e.message);
      }
      if (e instanceof WorkbookNotFoundError) {
        return err(call.id, 'WorkbookNotFound', e.message);
      }
      // Office.js errors have a `.code` string property; everything else is OfficeApiError.
      const msg = e instanceof Error ? e.message : String(e);
      return err(call.id, 'OfficeApiError', msg);
    }
  }
}

type ErrorCode = NonNullable<ToolResult['error']>['code'];

function err(toolCallId: string, code: ErrorCode, message: string): ToolResult {
  return { toolCallId, ok: false, error: { code, message } };
}
