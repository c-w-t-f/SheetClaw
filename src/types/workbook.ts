export interface SheetSummary {
  name: string;
  position: number;
  visible: boolean;
  usedRange?: { address: string; rowCount: number; colCount: number };
  headers?: string[];
}

export interface WorkbookHandle {
  workbookId: string;
  name: string;
  isActive: boolean;
  isHost: boolean;
  sheets: SheetSummary[];
  lastRefreshed: string;
  capability: 'full' | 'host-only';
}

export type WorkbookManifest = {
  active: string;
  workbooks: WorkbookHandle[];
};
