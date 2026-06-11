import type { ProviderKey } from '../types';

export type NativeSearchKind =
  | 'openrouter-server-tool'
  | 'anthropic-server-tool'
  | 'kimi-builtin-function'
  | 'qwen-enable-search'
  | 'glm-web-search-tool';

export interface NativeSearchCapability {
  provider: ProviderKey;
  kind: NativeSearchKind;
  supportsModel?: (model: string) => boolean;
  modelSupportLabel?: string;
  costNote: string;
}

export type SearchTier = 'native' | 'byok';

export type SearchTierResolution =
  | {
      tier: 'native';
      provider: ProviderKey;
      model: string;
      capability: NativeSearchCapability;
      nativeUnavailableReason?: undefined;
    }
  | {
      tier: 'byok';
      provider: ProviderKey;
      model: string;
      capability?: NativeSearchCapability;
      nativeUnavailableReason?: string;
    };

export type SearchToggleResolution = SearchTierResolution & {
  byokReady: boolean;
  available: boolean;
};

const QWEN_NATIVE_MODELS = ['qwen3.5-plus', 'qwen3.5-flash', 'qwen3-max'];

function supportsQwenNativeSearch(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return QWEN_NATIVE_MODELS.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}-`));
}

export const NATIVE_SEARCH: Partial<Record<ProviderKey, NativeSearchCapability>> = {
  generic: {
    provider: 'generic',
    kind: 'openrouter-server-tool',
    costNote: 'OpenRouter native search is billed to your OpenRouter key, currently about $0.005 per search call.',
  },
  anthropic: {
    provider: 'anthropic',
    kind: 'anthropic-server-tool',
    costNote: 'Anthropic native search is billed to your Anthropic key, currently about $10 per 1,000 searches plus result tokens.',
  },
  kimi: {
    provider: 'kimi',
    kind: 'kimi-builtin-function',
    costNote: 'Kimi native search is billed to your Moonshot key, currently about $0.005 per search call.',
  },
  qwen: {
    provider: 'qwen',
    kind: 'qwen-enable-search',
    supportsModel: supportsQwenNativeSearch,
    modelSupportLabel: 'qwen3.5-plus, qwen3.5-flash, or qwen3-max in thinking mode',
    costNote: 'Qwen native search is billed to your DashScope key under the provider search pricing for the selected model.',
  },
  glm: {
    provider: 'glm',
    kind: 'glm-web-search-tool',
    costNote: 'GLM native search is billed to your Z.AI key under the provider search pricing for the selected model.',
  },
};

export function getNativeSearchCapability(
  provider: ProviderKey,
  model: string
): NativeSearchCapability | undefined {
  const capability = NATIVE_SEARCH[provider];
  if (!capability) return undefined;
  if (capability.supportsModel && !capability.supportsModel(model)) return undefined;
  return capability;
}

export function resolveSearchTier(provider: ProviderKey, model: string): SearchTierResolution {
  const capability = NATIVE_SEARCH[provider];
  if (!capability) return { tier: 'byok', provider, model };
  if (capability.supportsModel && !capability.supportsModel(model)) {
    return {
      tier: 'byok',
      provider,
      model,
      capability,
      nativeUnavailableReason: capability.modelSupportLabel
        ? `Native search requires ${capability.modelSupportLabel}.`
        : 'Native search is not available for this model.',
    };
  }
  return { tier: 'native', provider, model, capability };
}

export function resolveSearchToggle(input: {
  provider: ProviderKey;
  model: string;
  byokReady: boolean;
}): SearchToggleResolution {
  const resolution = resolveSearchTier(input.provider, input.model);
  return {
    ...resolution,
    byokReady: input.byokReady,
    available: resolution.tier === 'native' || input.byokReady,
  };
}

export function getSearchSettingsStatusText(
  providerLabel: string,
  resolution: SearchTierResolution
): string {
  if (resolution.tier === 'native') {
    return `${providerLabel} has native web search; searches run on your provider key. ${resolution.capability.costNote}`;
  }
  if (resolution.nativeUnavailableReason) {
    return `${providerLabel} native web search is unavailable for ${resolution.model || 'this model'}: ${resolution.nativeUnavailableReason} Configure a search provider below to use the BYOK tier.`;
  }
  return `${providerLabel} has no native web search - configure a search provider below to enable search.`;
}

export function getByokSectionNote(
  providerLabel: string,
  resolution: SearchTierResolution
): string | undefined {
  if (resolution.tier !== 'native') return undefined;
  return `Not used while ${providerLabel} is active; native search takes precedence.`;
}

export function getProviderNativeSearchCaption(provider: ProviderKey, model: string): string {
  const resolution = resolveSearchTier(provider, model);
  if (resolution.tier === 'native') return 'Native web search: yes';
  if (resolution.nativeUnavailableReason) {
    return `Native web search: no for this model - ${resolution.nativeUnavailableReason}`;
  }
  return 'Native web search: no - uses your search API key (Search tab)';
}

export function getUnavailableSearchToggleHint(
  providerLabel: string,
  resolution: SearchTierResolution
): string {
  if (resolution.nativeUnavailableReason) {
    return `${providerLabel} native search is not available for ${resolution.model || 'this model'}. ${resolution.nativeUnavailableReason} Select a supported model or configure a search API key in Settings - Search.`;
  }
  return `${providerLabel} has no native web search. Configure a search API key in Settings - Search to enable search.`;
}
