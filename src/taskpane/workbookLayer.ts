import { getAgentLoop } from '../agent/index';
import { createWorkbookLayer } from '../workbook/index';

let layer: ReturnType<typeof createWorkbookLayer> | null = null;

export function getTaskpaneWorkbookLayer(): ReturnType<typeof createWorkbookLayer> {
  if (!layer) layer = createWorkbookLayer();
  return layer;
}

export function getTaskpaneAgentLoop(): ReturnType<typeof getAgentLoop> {
  const { registry, executor, snapshots } = getTaskpaneWorkbookLayer();
  return getAgentLoop(registry, executor, snapshots);
}
