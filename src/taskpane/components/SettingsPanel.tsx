import { useState, useEffect } from 'react';
import {
  Body1Strong,
  Button,
  Caption1,
  Combobox,
  Field,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Switch,
  Tab,
  TabList,
  tokens,
  type SelectTabData,
} from '@fluentui/react-components';
import { useStore } from '../../store/index';
import { createAdapter } from '../../adapters/index';
import type { ProviderConfig, ProviderKey } from '../../types';

const PROVIDERS: { key: ProviderKey; label: string }[] = [
  { key: 'ollama',     label: 'Ollama' },
  { key: 'openai',    label: 'OpenAI' },
  { key: 'anthropic', label: 'Anthropic' },
  { key: 'generic',   label: 'Generic' },
];

// Curated fallback lists shown before any live fetch.
// Ollama has no fallback — depends entirely on what's locally installed.
// Anthropic: listModels() is a static local list, no key needed, so we always fetch.
// OpenAI: filter for chat-capable models after live fetch; show curated set before that.
// Generic/OpenRouter: show popular options as hints.
const STATIC_MODELS: Partial<Record<ProviderKey, string[]>> = {
  openai: [
    'gpt-4o', 'gpt-4o-mini',
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'o3', 'o3-mini', 'o4-mini',
  ],
  generic: [
    'openai/gpt-4o', 'openai/gpt-4o-mini',
    'anthropic/claude-sonnet-4-6', 'anthropic/claude-opus-4-8',
    'deepseek/deepseek-chat', 'deepseek/deepseek-r1',
    'qwen/qwen3-235b-a22b', 'qwen/qwen3.7-max',
    'meta-llama/llama-3.3-70b-instruct',
    'google/gemini-2.0-flash-001',
  ],
};

// Chat-capable model prefixes for OpenAI — used to filter /v1/models noise.
const OPENAI_CHAT_PREFIXES = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-'];
function isOpenAIChatModel(id: string): boolean {
  return OPENAI_CHAT_PREFIXES.some(p => id.startsWith(p));
}

export default function SettingsPanel() {
  const providers        = useStore(s => s.providers);
  const appConfig        = useStore(s => s.appConfig);
  const authStates       = useStore(s => s.authStates);
  const setProvider      = useStore(s => s.setProvider);
  const setActiveProvider = useStore(s => s.setActiveProvider);
  const setAppConfig     = useStore(s => s.setAppConfig);
  const saveApiKey       = useStore(s => s.saveApiKey);
  const clearApiKey      = useStore(s => s.clearApiKey);

  const [selectedTab, setSelectedTab] = useState<ProviderKey>(appConfig.activeProvider);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Provider tabs */}
      <TabList
        selectedValue={selectedTab}
        onTabSelect={(_, d: SelectTabData) => setSelectedTab(d.value as ProviderKey)}
        size="small"
        style={{ flexShrink: 0, paddingLeft: 4, borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}
      >
        {PROVIDERS.map(p => (
          <Tab key={p.key} value={p.key}>
            {p.label}
            {appConfig.activeProvider === p.key && (
              <span style={{ marginLeft: 4, color: tokens.colorBrandForeground1, fontSize: 10 }}>●</span>
            )}
          </Tab>
        ))}
      </TabList>

      {/* Provider config — key forces remount on tab switch so state resets */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <ProviderForm
          key={selectedTab}
          providerKey={selectedTab}
          cfg={providers[selectedTab]}
          auth={authStates[selectedTab]}
          isActive={appConfig.activeProvider === selectedTab}
          onSetActive={() => setActiveProvider(selectedTab)}
          onSave={(patch) => setProvider(selectedTab, patch)}
          onSaveKey={(key) => saveApiKey(selectedTab, key)}
          onClearKey={() => clearApiKey(selectedTab)}
        />
      </div>

      {/* Safety / global settings */}
      <div style={{
        flexShrink: 0,
        padding: '10px 12px',
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <Body1Strong>Safety</Body1Strong>
        <Switch
          label="Auto-approve writes this session"
          checked={appConfig.autoApproveSession}
          onChange={(_, d) => setAppConfig({ autoApproveSession: d.checked })}
        />
      </div>
    </div>
  );
}

// ── Per-provider form ──────────────────────────────────────────────────────

interface ProviderFormProps {
  providerKey: ProviderKey;
  cfg: ProviderConfig;
  auth: import('../../types').AuthState;
  isActive: boolean;
  onSetActive: () => void;
  onSave: (patch: Partial<ProviderConfig>) => void;
  onSaveKey: (key: string) => void;
  onClearKey: () => void;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

function ProviderForm({
  providerKey, cfg, auth, isActive,
  onSetActive, onSave, onSaveKey, onClearKey,
}: ProviderFormProps) {
  // Draft local state for fields that need buffering (base URL, typed model).
  // Committed to the store (and localStorage) on blur / dropdown selection.
  const [baseUrl, setBaseUrl]   = useState(cfg.baseUrl);
  const [model, setModel]       = useState(cfg.model);
  const [apiKey, setApiKey]     = useState('');
  const [showKey, setShowKey]   = useState(false);

  // Pre-seed model list: prefer persisted knownModels, then static fallback.
  const initialList = cfg.knownModels?.map(m => m.id)
    ?? STATIC_MODELS[providerKey]
    ?? [];
  const [modelList, setModelList] = useState<string[]>(initialList);
  const [loadState, setLoadState] = useState<LoadState>(
    initialList.length > 0 ? 'loaded' : 'idle'
  );
  const [loadError, setLoadError] = useState('');

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg]   = useState('');

  const needsKey = providerKey !== 'ollama';
  const keySet   = !!auth._key;

  // Auto-load on mount:
  //  - ollama: always (no auth)
  //  - anthropic: always (listModels() is a static local list, no key needed)
  //  - openai / generic: only if key already saved
  useEffect(() => {
    const canLoad = providerKey === 'ollama'
      || providerKey === 'anthropic'
      || !!auth._key;
    if (!canLoad) return;
    void fetchModels(cfg.baseUrl, auth._key ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist helpers — called immediately, no Save button required ──────────

  function commitBaseUrl(url: string) {
    onSave({ baseUrl: url, enabled: true });
  }

  function commitModel(m: string) {
    onSave({ model: m, enabled: true });
  }

  // ── Model list fetch ───────────────────────────────────────────────────────

  async function fetchModels(url: string, key: string): Promise<string[]> {
    setLoadState('loading');
    setLoadError('');
    try {
      const adapter = createAdapter({ ...cfg, baseUrl: url }, key);
      let found = await adapter.listModels();

      // OpenAI's /v1/models includes embeddings, audio, image models.
      // Filter to chat-capable models for a cleaner picker.
      if (providerKey === 'openai') {
        const chat = found.filter(m => isOpenAIChatModel(m.id));
        if (chat.length > 0) found = chat;
      }

      const ids = found.map(m => m.id).sort();
      setModelList(ids);
      setLoadState('loaded');
      onSave({ knownModels: found });
      return ids;
    } catch (e) {
      setLoadState('error');
      setLoadError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }

  async function test() {
    setTestStatus('testing');
    setTestMsg('');
    try {
      const key = apiKey || auth._key || '';
      const ids = await fetchModels(baseUrl, key);
      setTestStatus('ok');
      setTestMsg(`Connected — ${ids.length} model${ids.length !== 1 ? 's' : ''} available`);
    } catch {
      setTestStatus('error');
      setTestMsg(loadError || 'Connection failed');
    }
  }

  function saveKey() {
    if (apiKey) {
      onSaveKey(apiKey);
      setApiKey('');
    }
  }

  const modelLabel = loadState === 'loading'
    ? 'Model (loading…)'
    : loadState === 'loaded' && modelList.length > 0
    ? `Model (${modelList.length} available)`
    : 'Model';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Active indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isActive ? (
          <Caption1 style={{ color: tokens.colorBrandForeground1, fontWeight: 600 }}>● Active provider</Caption1>
        ) : (
          <Button size="small" appearance="subtle" onClick={onSetActive}>Set as active</Button>
        )}
      </div>

      {/* Base URL — auto-saves on blur */}
      <Field label="Base URL">
        <Input
          value={baseUrl}
          onChange={(_, d) => setBaseUrl(d.value)}
          onBlur={() => commitBaseUrl(baseUrl)}
          size="small"
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Field>

      {/* Model — Combobox when list is available, Input fallback */}
      <Field label={modelLabel}>
        {loadState === 'loading' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32 }}>
            <Spinner size="extra-small" />
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Fetching models…</Caption1>
          </div>
        ) : modelList.length > 0 ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Combobox
              value={model}
              selectedOptions={model ? [model] : []}
              onOptionSelect={(_, d) => {
                const m = d.optionValue ?? '';
                setModel(m);
                commitModel(m);
              }}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => commitModel(model)}
              placeholder="Select or type a model…"
              size="small"
              style={{ flex: 1, minWidth: 0 }}
              freeform
            >
              {modelList.map(id => (
                <Option key={id} value={id}>{id}</Option>
              ))}
            </Combobox>
            <Button
              size="small"
              appearance="subtle"
              title="Refresh model list"
              onClick={() => void fetchModels(baseUrl, auth._key ?? '')}
            >↺</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Input
              value={model}
              onChange={(_, d) => setModel(d.value)}
              onBlur={() => commitModel(model)}
              placeholder={providerKey === 'ollama' ? 'e.g. llama3.2' : 'e.g. gpt-4o'}
              size="small"
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
            />
            <Button
              size="small"
              appearance="subtle"
              title="Fetch available models"
              disabled={needsKey && !keySet && !apiKey}
              onClick={() => void fetchModels(baseUrl, apiKey || auth._key || '')}
            >↺</Button>
          </div>
        )}
        {loadState === 'error' && (
          <Caption1 style={{ color: tokens.colorPaletteRedForeground1, marginTop: 2 }}>
            {loadError}
          </Caption1>
        )}
      </Field>

      {/* API Key */}
      {needsKey && (
        <Field label="API Key">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Input
              type={showKey ? 'text' : 'password'}
              placeholder={keySet ? auth.apiKeyMasked : 'Enter API key…'}
              value={apiKey}
              onChange={(_, d) => setApiKey(d.value)}
              size="small"
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
            />
            <Button size="small" appearance="subtle" onClick={() => setShowKey(s => !s)}>
              {showKey ? 'Hide' : 'Show'}
            </Button>
            {keySet && (
              <Button size="small" appearance="subtle" onClick={onClearKey}>Clear</Button>
            )}
          </div>
        </Field>
      )}

      {/* Auth status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Label size="small" style={{ color: tokens.colorNeutralForeground3 }}>Status:</Label>
        <Caption1 style={{
          color: auth.state === 'authenticated'
            ? tokens.colorPaletteGreenForeground1
            : auth.state === 'unauthenticated' && !needsKey
            ? tokens.colorPaletteGreenForeground1
            : tokens.colorNeutralForeground3,
        }}>
          {auth.state === 'authenticated' ? '✓ authenticated'
            : auth.state === 'unauthenticated' && !needsKey ? '✓ no auth needed'
            : auth.state}
        </Caption1>
      </div>

      {/* Actions — base URL and model auto-save; key requires explicit action */}
      <div style={{ display: 'flex', gap: 8 }}>
        {needsKey && apiKey && (
          <Button appearance="primary" size="small" onClick={saveKey}>Save key</Button>
        )}
        <Button
          appearance="secondary"
          size="small"
          disabled={testStatus === 'testing'}
          onClick={() => void test()}
        >
          {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
        </Button>
      </div>

      {/* Test result */}
      {testStatus !== 'idle' && testStatus !== 'testing' && (
        <MessageBar intent={testStatus === 'ok' ? 'success' : 'error'}>
          <MessageBarBody>
            <Caption1>{testMsg}</Caption1>
          </MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}
