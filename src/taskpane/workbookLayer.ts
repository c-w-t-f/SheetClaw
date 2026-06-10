import { getAgentLoop } from '../agent/index';
import { createWorkbookLayer } from '../workbook/index';
import { getAuthCredential } from '../auth/credentials';
import { useStore } from '../store/index';
import { FETCH_URL, createFetchUrlHandler } from '../web/fetch';
import { WEB_SEARCH, createWebSearchHandler } from '../web/search';
import type { SearchProviderId } from '../types';

let layer: ReturnType<typeof createWorkbookLayer> | null = null;

export function getTaskpaneWorkbookLayer(): ReturnType<typeof createWorkbookLayer> {
  if (!layer) {
    layer = createWorkbookLayer();
    layer.executor.register(FETCH_URL, createFetchUrlHandler());
    layer.executor.register(WEB_SEARCH, createWebSearchHandler({
      getProvider: () => useStore.getState().appConfig.webAccess.provider,
      getApiKey: (provider: SearchProviderId) =>
        getAuthCredential(useStore.getState().searchAuthStates[provider]),
      getBaseUrl: () => useStore.getState().appConfig.webAccess.baseUrl,
    }));
  }
  return layer;
}

export function getTaskpaneAgentLoop(): ReturnType<typeof getAgentLoop> {
  const { registry, executor, snapshots } = getTaskpaneWorkbookLayer();
  return getAgentLoop(registry, executor, snapshots);
}
