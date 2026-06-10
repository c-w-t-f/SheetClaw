const WEB_TOOL_NAMES = new Set(['web_search', 'fetch_url']);

export function filterToolsForRun<T extends { name: string }>(
  toolSpecs: T[],
  webSearchEnabled: boolean,
  webConfigured: boolean
): T[] {
  if (webSearchEnabled && webConfigured) return toolSpecs;
  return toolSpecs.filter(spec => !WEB_TOOL_NAMES.has(spec.name));
}
