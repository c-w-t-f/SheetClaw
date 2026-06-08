import { useState } from 'react';
import {
  Body1Strong,
  Button,
  Caption1,
  Field,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  Switch,
  Tab,
  TabList,
  tokens,
  type SelectTabData,
} from '@fluentui/react-components';
import { useStore } from '../../store/index';
import { createAdapter } from '../../adapters/index';
import type { ProviderKey } from '../../types';

const PROVIDERS: { key: ProviderKey; label: string }[] = [
  { key: 'ollama',    label: 'Ollama' },
  { key: 'openai',   label: 'OpenAI' },
  { key: 'anthropic',label: 'Anthropic' },
  { key: 'generic',  label: 'Generic' },
];

export default function SettingsPanel() {
  const providers   = useStore(s => s.providers);
  const appConfig   = useStore(s => s.appConfig);
  const authStates  = useStore(s => s.authStates);
  const setProvider = useStore(s => s.setProvider);
  const setActiveProvider = useStore(s => s.setActiveProvider);
  const setAppConfig = useStore(s => s.setAppConfig);
  const saveApiKey  = useStore(s => s.saveApiKey);
  const clearApiKey = useStore(s => s.clearApiKey);

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

      {/* Provider config form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <ProviderForm
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
  cfg: import('../../types').ProviderConfig;
  auth: import('../../types').AuthState;
  isActive: boolean;
  onSetActive: () => void;
  onSave: (patch: Partial<import('../../types').ProviderConfig>) => void;
  onSaveKey: (key: string) => void;
  onClearKey: () => void;
}

function ProviderForm({ providerKey, cfg, auth, isActive, onSetActive, onSave, onSaveKey, onClearKey }: ProviderFormProps) {
  const [baseUrl, setBaseUrl]   = useState(cfg.baseUrl);
  const [model, setModel]       = useState(cfg.model);
  const [apiKey, setApiKey]     = useState('');
  const [showKey, setShowKey]   = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg]   = useState('');
  const [models, setModels]     = useState<string[]>([]);

  const needsKey = providerKey !== 'ollama';
  const keySet = !!auth._key;

  function save() {
    onSave({ baseUrl, model, enabled: true });
    if (apiKey) onSaveKey(apiKey);
    else if (!keySet && !needsKey) onSaveKey(''); // Ollama: mark authenticated
    setApiKey('');
  }

  async function test() {
    setTestStatus('testing');
    setTestMsg('');
    try {
      const key = apiKey || auth._key || '';
      const adapter = createAdapter({ ...cfg, baseUrl, model }, key);
      const found = await adapter.listModels();
      setModels(found.map(m => m.id));
      setTestStatus('ok');
      setTestMsg(`Connected — ${found.length} model${found.length !== 1 ? 's' : ''} found`);
    } catch (e) {
      setTestStatus('error');
      setTestMsg(e instanceof Error ? e.message : String(e));
    }
  }

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

      {/* Base URL */}
      <Field label="Base URL">
        <Input
          value={baseUrl}
          onChange={(_, d) => setBaseUrl(d.value)}
          size="small"
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Field>

      {/* Model */}
      <Field label={`Model${models.length > 0 ? ` (${models.length} available)` : ''}`}>
        <Input
          value={model}
          onChange={(_, d) => setModel(d.value)}
          placeholder="e.g. llama3.2 or gpt-4o"
          list={`models-${providerKey}`}
          size="small"
        />
        {models.length > 0 && (
          <datalist id={`models-${providerKey}`}>
            {models.map(m => <option key={m} value={m} />)}
          </datalist>
        )}
      </Field>

      {/* API Key */}
      {needsKey && (
        <Field label="API Key">
          <div style={{ display: 'flex', gap: 6 }}>
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
            : tokens.colorNeutralForeground3
        }}>
          {auth.state === 'authenticated' ? '✓ authenticated'
            : auth.state === 'unauthenticated' && !needsKey ? '✓ no auth needed'
            : auth.state}
        </Caption1>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button appearance="primary" size="small" onClick={save}>Save</Button>
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
