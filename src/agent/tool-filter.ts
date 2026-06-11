import type { SearchToggleResolution } from '../adapters/native-search';

const WEB_SEARCH_TOOL_NAME = 'web_search';
const FETCH_URL_TOOL_NAME = 'fetch_url';
const WEB_TOOL_NAMES = new Set([WEB_SEARCH_TOOL_NAME, FETCH_URL_TOOL_NAME]);

export function filterToolsForRun<T extends { name: string }>(
  toolSpecs: T[],
  webSearchEnabled: boolean,
  search: Pick<SearchToggleResolution, 'tier' | 'available'>
): T[] {
  if (!webSearchEnabled || !search.available) {
    return toolSpecs.filter(spec => !WEB_TOOL_NAMES.has(spec.name));
  }
  if (search.tier === 'native') {
    return toolSpecs.filter(spec => spec.name !== WEB_SEARCH_TOOL_NAME);
  }
  return toolSpecs;
}
