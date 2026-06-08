import { useState, useRef } from 'react';
import {
  Body1Strong,
  Body1,
  Caption1,
  Button,
  Input,
  Label,
  Select,
  Spinner,
  MessageBar,
  MessageBarBody,
  tokens,
} from '@fluentui/react-components';
import { createAdapter } from '../../adapters';
import { runHarness } from '../../adapters/harness';
import type { ProviderKey } from '../../types';
import type { LLMStreamEvent } from '../../types';

type ProviderOption = { key: ProviderKey; label: string; needsKey: boolean; defaultBase: string; defaultModel: string };

const PROVIDERS: ProviderOption[] = [
  { key: 'ollama',    label: 'Ollama (local)',   needsKey: false, defaultBase: 'http://localhost:11434', defaultModel: 'llama3.2' },
  { key: 'openai',   label: 'OpenAI',            needsKey: true,  defaultBase: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  { key: 'anthropic',label: 'Anthropic',         needsKey: true,  defaultBase: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-6' },
  { key: 'generic',  label: 'Generic / OpenRouter', needsKey: true, defaultBase: 'https://openrouter.ai/api/v1', defaultModel: '' },
];

function eventSummary(ev: LLMStreamEvent): string {
  switch (ev.type) {
    case 'text-delta':        return `text-delta: "${ev.delta}"`;
    case 'tool-call-start':   return `tool-call-start #${ev.index} id=${ev.id} name=${ev.name}`;
    case 'tool-call-delta':   return `tool-call-delta #${ev.index}: ${ev.argumentsDelta}`;
    case 'tool-call-end':     return `tool-call-end #${ev.index}`;
    case 'usage':             return `usage in=${ev.inputTokens} out=${ev.outputTokens} src=${ev.source}`;
    case 'done':              return `done finishReason=${ev.finishReason}`;
    case 'error':             return `error ${ev.error.code}: ${ev.error.message}`;
    default:                  return JSON.stringify(ev);
  }
}

export default function HarnessPanel() {
  const [providerKey, setProviderKey] = useState<ProviderKey>('ollama');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(PROVIDERS[0].defaultBase);
  const [model, setModel] = useState(PROVIDERS[0].defaultModel);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ pass: boolean; message: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function onProviderChange(key: ProviderKey) {
    const opt = PROVIDERS.find(p => p.key === key)!;
    setProviderKey(key);
    setBaseUrl(opt.defaultBase);
    setModel(opt.defaultModel);
    setApiKey('');
    setLog([]);
    setResult(null);
  }

  async function run() {
    setLog([]);
    setResult(null);
    setRunning(true);

    const opt = PROVIDERS.find(p => p.key === providerKey)!;
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const client = createAdapter(
        { provider: providerKey, enabled: true, baseUrl, model, authMode: opt.needsKey ? 'apikey' : 'none', authStateRef: '', contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 } },
        apiKey
      );

      for await (const hev of runHarness(client, model, ac.signal)) {
        if (hev.type === 'raw') {
          setLog(prev => [...prev, eventSummary(hev.event)]);
        } else {
          setResult({ pass: hev.pass, message: hev.message });
        }
      }
    } catch (e) {
      setResult({ pass: false, message: `Unhandled error: ${String(e)}` });
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  const opt = PROVIDERS.find(p => p.key === providerKey)!;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Body1Strong>G1 — Tool-calling harness</Body1Strong>
      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
        Sends a canary tool-call prompt to the selected provider and verifies a well-formed normalized response.
      </Caption1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <Label htmlFor="hp-provider">Provider</Label>
          <Select
            id="hp-provider"
            value={providerKey}
            onChange={(_, d) => onProviderChange(d.value as ProviderKey)}
            disabled={running}
          >
            {PROVIDERS.map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="hp-base">Base URL</Label>
          <Input
            id="hp-base"
            value={baseUrl}
            onChange={(_, d) => setBaseUrl(d.value)}
            disabled={running}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <Label htmlFor="hp-model">Model</Label>
          <Input
            id="hp-model"
            value={model}
            onChange={(_, d) => setModel(d.value)}
            disabled={running}
            style={{ width: '100%' }}
          />
        </div>

        {opt.needsKey && (
          <div>
            <Label htmlFor="hp-key">API Key</Label>
            <Input
              id="hp-key"
              type="password"
              value={apiKey}
              onChange={(_, d) => setApiKey(d.value)}
              disabled={running}
              style={{ width: '100%' }}
              placeholder="sk-..."
            />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button appearance="primary" onClick={run} disabled={running || (opt.needsKey && !apiKey) || !model}>
          {running ? <><Spinner size="tiny" />&nbsp;Running…</> : 'Run canary test'}
        </Button>
        {running && (
          <Button appearance="secondary" onClick={stop}>Stop</Button>
        )}
      </div>

      {log.length > 0 && (
        <div
          style={{
            background: tokens.colorNeutralBackground2,
            borderRadius: 4,
            padding: '8px 10px',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          <Caption1 style={{ display: 'block', marginBottom: 4, color: tokens.colorNeutralForeground3 }}>
            Event stream ({log.length} events)
          </Caption1>
          {log.map((line, i) => (
            <Body1
              key={i}
              style={{
                display: 'block',
                fontSize: 11,
                fontFamily: 'monospace',
                color: line.startsWith('error') ? tokens.colorPaletteRedForeground1 : tokens.colorNeutralForeground1,
              }}
            >
              {line}
            </Body1>
          ))}
        </div>
      )}

      {result && (
        <MessageBar intent={result.pass ? 'success' : 'error'}>
          <MessageBarBody>
            <strong>{result.pass ? 'PASS' : 'FAIL'}</strong> — {result.message}
          </MessageBarBody>
        </MessageBar>
      )}

      <Caption1 style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}>
        G1 gate: every tool-capable model must PASS before Phase 4. Models that FAIL should be marked
        non-tool-capable in your notes.
      </Caption1>
    </div>
  );
}
