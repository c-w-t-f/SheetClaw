export { AgentLoop } from './loop';
export type { LoopRunner } from './loop';
export { ContextBuilder, estimateTokens } from './context-builder';

import { AgentLoop } from './loop';
import type { WorkbookRegistry } from '../workbook/registry';
import type { ToolExecutor } from '../workbook/executor';
import type { SnapshotManager } from '../workbook/snapshot';

let _loop: AgentLoop | null = null;

export function getAgentLoop(
  registry: WorkbookRegistry,
  executor: ToolExecutor,
  snapshots: SnapshotManager
): AgentLoop {
  if (!_loop) _loop = new AgentLoop(registry, executor, snapshots);
  return _loop;
}
