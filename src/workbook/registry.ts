import { ulid } from 'ulid';
import type { WorkbookHandle, WorkbookManifest, SheetSummary } from '../types';

export type ExcelRunner = <T>(fn: (ctx: Excel.RequestContext) => Promise<T>) => Promise<T>;

export class WorkbookNotFoundError extends Error {
  constructor(public readonly workbookId: string) {
    super(`Workbook not found: "${workbookId}"`);
    this.name = 'WorkbookNotFoundError';
  }
}

// ── WorkbookRegistry ───────────────────────────────────────────────────────
// D8: host-only — always exactly one WorkbookHandle, scoped to the add-in's
// host workbook. Multi-workbook enumeration is not available on Windows
// desktop Office without a sidecar.

export class WorkbookRegistry {
  private handles = new Map<string, WorkbookHandle>();
  private activeId: string | null = null;
  // Stable for the session; generated on first refresh and reused thereafter.
  private hostId: string | null = null;

  async refresh(runner: ExcelRunner = fn => Excel.run(fn)): Promise<WorkbookHandle[]> {
    if (!this.hostId) this.hostId = ulid();
    const id = this.hostId;

    const data = await runner(async ctx => {
      ctx.workbook.load('name');
      ctx.workbook.worksheets.load('items/name,items/position,items/visibility');
      await ctx.sync();

      const sheets: SheetSummary[] = ctx.workbook.worksheets.items.map(ws => ({
        name: ws.name,
        position: ws.position,
        visible: ws.visibility === Excel.SheetVisibility.visible,
      }));

      return { name: ctx.workbook.name as string, sheets };
    });

    const handle: WorkbookHandle = {
      workbookId: id,
      name: data.name,
      isActive: true,
      isHost: true,
      sheets: data.sheets,
      lastRefreshed: new Date().toISOString(),
      capability: 'host-only',
    };

    this.handles.set(id, handle);
    if (!this.activeId) this.activeId = id;
    return [handle];
  }

  resolve(id: string): WorkbookHandle {
    const h = this.handles.get(id);
    if (!h) throw new WorkbookNotFoundError(id);
    return h;
  }

  setActive(id: string): void {
    this.resolve(id);
    this.activeId = id;
  }

  getManifest(): WorkbookManifest {
    return {
      active: this.activeId ?? '',
      workbooks: Array.from(this.handles.values()),
    };
  }

  getHostId(): string | null { return this.hostId; }
  getActiveId(): string | null { return this.activeId; }
}
