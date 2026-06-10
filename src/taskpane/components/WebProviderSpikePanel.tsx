import { useMemo, useState } from 'react';
import {
  Body1Strong,
  Button,
  Caption1,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Textarea,
  tokens,
} from '@fluentui/react-components';

type CandidateId =
  | 'tavily'
  | 'google-cse'
  | 'jina-search'
  | 'brave'
  | 'searxng'
  | 'mediawiki'
  | 'jina-reader';

type AuthMechanism = 'none' | 'bearer-header' | 'custom-header' | 'query-param' | 'local-config';

interface Candidate {
  id: CandidateId;
  label: string;
  costNote: string;
  authMechanism: AuthMechanism;
  setupHint: string;
  docsUrl: string;
  requiresKey: boolean;
  requiresCx?: boolean;
  requiresBaseUrl?: boolean;
  requiresTargetUrl?: boolean;
}

interface CandidateInput {
  key: string;
  cx: string;
  baseUrl: string;
  targetUrl: string;
}

interface SpikeResult {
  id: CandidateId;
  label: string;
  endpoint: string;
  method: string;
  authMechanism: AuthMechanism;
  keyProvided: boolean;
  startedAt: string;
  durationMs: number;
  cors: 'pass' | 'fail';
  preflight: 'pass' | 'fail' | 'not-applicable' | 'unknown';
  status?: number;
  statusText?: string;
  responseType?: string;
  finalUrl?: string;
  exposedHeaders?: Record<string, string>;
  responseShape?: string;
  responseSample?: string;
  error?: string;
}

const CANDIDATES: Candidate[] = [
  {
    id: 'tavily',
    label: 'Tavily',
    costNote: 'Free-tier key; spec expectation: about 1,000 searches/month.',
    authMechanism: 'bearer-header',
    setupHint: 'Paste a Tavily API key. The request uses Authorization: Bearer and JSON POST.',
    docsUrl: 'https://docs.tavily.com/documentation/api-reference/endpoint/search',
    requiresKey: true,
  },
  {
    id: 'google-cse',
    label: 'Google Programmable Search',
    costNote: 'Free quota is commonly 100 queries/day; key is placed in the request URL.',
    authMechanism: 'query-param',
    setupHint: 'Paste a Google API key and Programmable Search Engine ID.',
    docsUrl: 'https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list',
    requiresKey: true,
    requiresCx: true,
  },
  {
    id: 'jina-search',
    label: 'Jina Search',
    costNote: 'Starter/free quota; search endpoint is rate-limited by account or IP.',
    authMechanism: 'bearer-header',
    setupHint: 'Paste a Jina API key if available. The request asks for JSON output.',
    docsUrl: 'https://jina.ai/reader/',
    requiresKey: false,
  },
  {
    id: 'brave',
    label: 'Brave Search API',
    costNote: 'Free-tier search key; spec expectation is roughly 2,000 searches/month.',
    authMechanism: 'custom-header',
    setupHint: 'Paste a Brave Search API key. The request uses X-Subscription-Token.',
    docsUrl: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started',
    requiresKey: true,
  },
  {
    id: 'searxng',
    label: 'SearXNG self-hosted',
    costNote: 'Self-hosted, keyless, no provider quota; instance must enable JSON and CORS.',
    authMechanism: 'local-config',
    setupHint: 'Enter the local instance base URL, for example a local port exposed by Docker.',
    docsUrl: 'https://docs.searxng.org/',
    requiresKey: false,
    requiresBaseUrl: true,
  },
  {
    id: 'mediawiki',
    label: 'Wikipedia/MediaWiki',
    costNote: 'Free, keyless, encyclopedic only; not a general search provider.',
    authMechanism: 'none',
    setupHint: 'No key required. The request uses the public MediaWiki API with origin=*.',
    docsUrl: 'https://www.mediawiki.org/wiki/API:Search',
    requiresKey: false,
  },
  {
    id: 'jina-reader',
    label: 'Jina Reader',
    costNote: 'Reader fallback candidate; keyless tier is rate-limited.',
    authMechanism: 'none',
    setupHint: 'Enter a public URL to verify reader fallback CORS and response shape.',
    docsUrl: 'https://jina.ai/reader/',
    requiresKey: false,
    requiresTargetUrl: true,
  },
];

const DEFAULT_INPUTS: Record<CandidateId, CandidateInput> = {
  tavily: { key: '', cx: '', baseUrl: '', targetUrl: '' },
  'google-cse': { key: '', cx: '', baseUrl: '', targetUrl: '' },
  'jina-search': { key: '', cx: '', baseUrl: '', targetUrl: '' },
  brave: { key: '', cx: '', baseUrl: '', targetUrl: '' },
  searxng: { key: '', cx: '', baseUrl: 'http://localhost:8080', targetUrl: '' },
  mediawiki: { key: '', cx: '', baseUrl: '', targetUrl: '' },
  'jina-reader': { key: '', cx: '', baseUrl: '', targetUrl: '' },
};

const DEFAULT_QUERY = 'current public data API examples';

export default function WebProviderSpikePanel() {
  const [selectedId, setSelectedId] = useState<CandidateId>('tavily');
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [inputs, setInputs] = useState<Record<CandidateId, CandidateInput>>(DEFAULT_INPUTS);
  const [results, setResults] = useState<SpikeResult[]>([]);
  const [running, setRunning] = useState<CandidateId | 'all' | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const selected = useMemo(
    () => CANDIDATES.find(c => c.id === selectedId) ?? CANDIDATES[0],
    [selectedId]
  );
  const currentInput = inputs[selected.id];
  const markdown = useMemo(() => formatAppendixMarkdown(results), [results]);

  function patchInput(id: CandidateId, patch: Partial<CandidateInput>) {
    setInputs(prev => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  }

  async function runCandidate(candidate: Candidate) {
    setRunning(candidate.id);
    const result = await probeCandidate(candidate, inputs[candidate.id], query);
    setResults(prev => [result, ...prev.filter(r => r.id !== candidate.id)]);
    setRunning(null);
  }

  async function runAll() {
    setRunning('all');
    const next: SpikeResult[] = [];
    for (const candidate of CANDIDATES) {
      next.push(await probeCandidate(candidate, inputs[candidate.id], query));
      setResults(prev => [next[next.length - 1], ...prev.filter(r => r.id !== candidate.id)]);
    }
    setRunning(null);
  }

  async function copyMarkdown() {
    setCopyState('idle');
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
    }
  }

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      padding: 12,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <MessageBar intent="warning">
        <MessageBarBody>
          <Caption1>
            Temporary Phase 0 diagnostics only. It runs browser fetches from the sideloaded taskpane
            so CORS/auth behavior matches the add-in environment.
          </Caption1>
        </MessageBarBody>
      </MessageBar>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Body1Strong>Provider verification spike</Body1Strong>
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
          Run each candidate and send the Appendix A markdown back to Codex. Keys stay in this page's memory
          and are never included in the export.
        </Caption1>
      </div>

      <Field label="Fixture query">
        <Input
          value={query}
          onChange={(_, d) => setQuery(d.value)}
          size="small"
        />
      </Field>

      <Field label="Candidate">
        <Select
          value={selectedId}
          onChange={(_, d) => setSelectedId(d.value as CandidateId)}
          size="small"
        >
          {CANDIDATES.map(candidate => (
            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
          ))}
        </Select>
      </Field>

      <div style={{
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: 6,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <Body1Strong>{selected.label}</Body1Strong>
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{selected.setupHint}</Caption1>
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{selected.costNote}</Caption1>
        <a href={selected.docsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
          Provider docs
        </a>

        {selected.requiresKey && (
          <Field label="API key">
            <Input
              type="password"
              value={currentInput.key}
              onChange={(_, d) => patchInput(selected.id, { key: d.value })}
              size="small"
              placeholder="Paste key for this diagnostics run"
            />
          </Field>
        )}

        {selected.id === 'jina-search' && (
          <Field label="API key (optional)">
            <Input
              type="password"
              value={currentInput.key}
              onChange={(_, d) => patchInput(selected.id, { key: d.value })}
              size="small"
              placeholder="Optional Jina key"
            />
          </Field>
        )}

        {selected.requiresCx && (
          <Field label="Search engine ID">
            <Input
              value={currentInput.cx}
              onChange={(_, d) => patchInput(selected.id, { cx: d.value })}
              size="small"
            />
          </Field>
        )}

        {selected.requiresBaseUrl && (
          <Field label="Base URL">
            <Input
              value={currentInput.baseUrl}
              onChange={(_, d) => patchInput(selected.id, { baseUrl: d.value })}
              size="small"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Field>
        )}

        {selected.requiresTargetUrl && (
          <Field label="Public URL to read">
            <Input
              value={currentInput.targetUrl}
              onChange={(_, d) => patchInput(selected.id, { targetUrl: d.value })}
              size="small"
              placeholder="https://..."
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Field>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            appearance="primary"
            size="small"
            disabled={!!running}
            onClick={() => void runCandidate(selected)}
          >
            {running === selected.id ? 'Running...' : 'Run selected'}
          </Button>
          <Button
            appearance="secondary"
            size="small"
            disabled={!!running}
            onClick={() => void runAll()}
          >
            {running === 'all' ? 'Running all...' : 'Run all'}
          </Button>
        </div>
      </div>

      {running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Spinner size="extra-small" />
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Running browser-side provider probe...</Caption1>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <Body1Strong>Results</Body1Strong>
        <Button
          size="small"
          appearance="secondary"
          disabled={results.length === 0}
          onClick={() => void copyMarkdown()}
        >
          {copyState === 'copied' ? 'Copied' : 'Copy Appendix A'}
        </Button>
      </div>
      {copyState === 'error' && (
        <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
          Clipboard copy failed. Select the markdown below manually.
        </Caption1>
      )}

      {results.length === 0 ? (
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No probes run yet.</Caption1>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map(result => (
            <ResultCard key={result.id} result={result} />
          ))}
        </div>
      )}

      {results.length > 0 && (
        <Field label="Appendix A markdown">
          <Textarea
            value={markdown}
            readOnly
            rows={12}
            resize="vertical"
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Field>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: SpikeResult }) {
  const ok = result.cors === 'pass' && result.status !== undefined && result.status < 500;
  return (
    <div style={{
      border: `1px solid ${ok ? tokens.colorPaletteGreenBorder2 : tokens.colorPaletteRedBorder2}`,
      borderRadius: 6,
      padding: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0,
    }}>
      <Body1Strong>{result.label}: {result.cors === 'pass' ? 'CORS pass' : 'CORS fail'}</Body1Strong>
      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
        {result.method} {result.endpoint} | auth: {result.authMechanism} | preflight: {result.preflight}
      </Caption1>
      {result.status !== undefined && (
        <Caption1>Status: {result.status} {result.statusText}</Caption1>
      )}
      {result.error && (
        <Caption1 style={{ color: tokens.colorPaletteRedForeground1, overflowWrap: 'anywhere' }}>
          {result.error}
        </Caption1>
      )}
      {result.responseShape && (
        <pre style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          fontSize: 11,
          background: tokens.colorNeutralBackground2,
          padding: 8,
          borderRadius: 4,
        }}>{result.responseShape}</pre>
      )}
    </div>
  );
}

async function probeCandidate(
  candidate: Candidate,
  input: CandidateInput,
  query: string
): Promise<SpikeResult> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  try {
    const request = buildRequest(candidate, input, query.trim() || DEFAULT_QUERY);
    const response = await fetch(request.url, request.init);
    const elapsed = Math.round(performance.now() - started);
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const json = tryParseJson(text);
    return {
      id: candidate.id,
      label: candidate.label,
      endpoint: redactUrl(request.url, candidate.authMechanism),
      method: request.init.method ?? 'GET',
      authMechanism: candidate.authMechanism,
      keyProvided: !!input.key.trim(),
      startedAt,
      durationMs: elapsed,
      cors: 'pass',
      preflight: request.preflightExpected ? 'pass' : 'not-applicable',
      status: response.status,
      statusText: response.statusText,
      responseType: response.type,
      finalUrl: redactUrl(response.url, candidate.authMechanism),
      exposedHeaders: collectHeaders(response.headers),
      responseShape: json ? describeJson(json) : `non-JSON ${contentType || 'unknown content-type'}`,
      responseSample: json ? sampleJson(json) : text.slice(0, 800),
    };
  } catch (e) {
    const fallback = safeRequestSummary(candidate, input, query.trim() || DEFAULT_QUERY);
    return {
      id: candidate.id,
      label: candidate.label,
      endpoint: fallback.url,
      method: fallback.method,
      authMechanism: candidate.authMechanism,
      keyProvided: !!input.key.trim(),
      startedAt,
      durationMs: Math.round(performance.now() - started),
      cors: 'fail',
      preflight: fallback.preflightExpected ? 'fail' : 'unknown',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildRequest(candidate: Candidate, input: CandidateInput, query: string) {
  const key = input.key.trim();
  const headers = new Headers();
  let url = '';
  let method = 'GET';
  let body: string | undefined;
  let preflightExpected = false;

  switch (candidate.id) {
    case 'tavily':
      if (!key) throw new Error('Missing Tavily API key.');
      url = 'https://api.tavily.com/search';
      method = 'POST';
      headers.set('Content-Type', 'application/json');
      headers.set('Authorization', `Bearer ${key}`);
      body = JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: 1,
        include_answer: false,
        include_raw_content: false,
      });
      preflightExpected = true;
      break;
    case 'google-cse': {
      if (!key) throw new Error('Missing Google API key.');
      if (!input.cx.trim()) throw new Error('Missing Programmable Search Engine ID.');
      const params = new URLSearchParams({
        key,
        cx: input.cx.trim(),
        q: query,
        num: '1',
      });
      url = `https://customsearch.googleapis.com/customsearch/v1?${params.toString()}`;
      break;
    }
    case 'jina-search': {
      const params = new URLSearchParams({ q: query });
      url = `https://s.jina.ai/?${params.toString()}`;
      headers.set('Accept', 'application/json');
      if (key) headers.set('Authorization', `Bearer ${key}`);
      preflightExpected = key.length > 0;
      break;
    }
    case 'brave': {
      if (!key) throw new Error('Missing Brave Search API key.');
      const params = new URLSearchParams({ q: query, count: '1' });
      url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
      headers.set('Accept', 'application/json');
      headers.set('X-Subscription-Token', key);
      preflightExpected = true;
      break;
    }
    case 'searxng': {
      const baseUrl = normalizeBaseUrl(input.baseUrl);
      const params = new URLSearchParams({ q: query, format: 'json' });
      url = `${baseUrl}/search?${params.toString()}`;
      headers.set('Accept', 'application/json');
      break;
    }
    case 'mediawiki': {
      const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        format: 'json',
        origin: '*',
        srlimit: '1',
      });
      url = `https://en.wikipedia.org/w/api.php?${params.toString()}`;
      break;
    }
    case 'jina-reader': {
      const target = input.targetUrl.trim();
      if (!/^https?:\/\//i.test(target)) throw new Error('Enter an absolute http(s) URL for reader verification.');
      url = `https://r.jina.ai/${target}`;
      headers.set('Accept', 'application/json');
      break;
    }
  }

  return {
    url,
    init: {
      method,
      headers,
      body,
    } satisfies RequestInit,
    preflightExpected,
  };
}

function safeRequestSummary(candidate: Candidate, input: CandidateInput, query: string) {
  try {
    const request = buildRequest(candidate, input, query);
    return {
      url: redactUrl(request.url, candidate.authMechanism),
      method: request.init.method ?? 'GET',
      preflightExpected: request.preflightExpected,
    };
  } catch {
    return { url: '(not built)', method: 'GET', preflightExpected: false };
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Missing SearXNG base URL.');
  return trimmed.replace(/\/+$/, '');
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => { out[key] = value; });
  return out;
}

function describeJson(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${describeJson(value[0], depth + 1)}${value.length > 1 ? ', ...' : ''}]`;
  }
  if (typeof value !== 'object') return typeof value;
  if (depth >= 3) return '{...}';

  const entries = Object.entries(value as Record<string, unknown>).slice(0, 12);
  const body = entries
    .map(([key, nested]) => `${indent(depth + 1)}${key}: ${describeJson(nested, depth + 1)}`)
    .join('\n');
  const suffix = Object.keys(value as Record<string, unknown>).length > entries.length
    ? `\n${indent(depth + 1)}...`
    : '';
  return `{\n${body}${suffix}\n${indent(depth)}}`;
}

function sampleJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized.length > 1200 ? `${serialized.slice(0, 1200)}...` : serialized;
}

function indent(depth: number): string {
  return '  '.repeat(depth);
}

function redactUrl(url: string, authMechanism: AuthMechanism): string {
  if (authMechanism !== 'query-param') return url;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('key')) parsed.searchParams.set('key', '[redacted]');
    return parsed.toString();
  } catch {
    return url.replace(/key=[^&]+/i, 'key=[redacted]');
  }
}

function formatAppendixMarkdown(results: SpikeResult[]): string {
  const ordered = [...results].sort((a, b) => a.label.localeCompare(b.label));
  if (ordered.length === 0) return 'No Phase 0 results yet.';

  const lines = [
    '## Appendix A - Phase 0 results',
    '',
    '| Provider | CORS/preflight | Auth mechanism | Status | Free-tier limits / pricing | Response shape sample | Notes |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const result of ordered) {
    const candidate = CANDIDATES.find(c => c.id === result.id);
    const cors = `${result.cors}${result.preflight !== 'not-applicable' ? ` / ${result.preflight}` : ''}`;
    const status = result.status === undefined ? 'n/a' : `${result.status} ${result.statusText ?? ''}`.trim();
    const shape = result.responseShape
      ? result.responseShape.replace(/\s+/g, ' ').slice(0, 180)
      : '';
    const notes = result.error
      ? `Error: ${result.error.replace(/\s+/g, ' ').slice(0, 160)}`
      : `Endpoint: ${result.endpoint}; key provided: ${result.keyProvided ? 'yes' : 'no'}`;
    lines.push([
      result.label,
      cors,
      result.authMechanism,
      status,
      candidate?.costNote ?? '',
      shape,
      notes,
    ].map(cell).join(' | '));
  }

  return lines.join('\n');
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|');
}
