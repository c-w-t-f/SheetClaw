import { useEffect, useState } from 'react';
import {
  Body1Strong,
  Caption1,
  MessageBar,
  MessageBarBody,
  Spinner,
  tokens,
} from '@fluentui/react-components';

type CheckStatus = 'pending' | 'ok' | 'fail';

interface Check {
  label: string;
  status: CheckStatus;
  detail: string;
}

const CHECKS_INITIAL: Check[] = [
  { label: 'HTTPS cert trusted', status: 'pending', detail: '' },
  { label: 'Loopback / localhost', status: 'pending', detail: '' },
  { label: 'Ollama', status: 'pending', detail: '' },
];

const statusIcon: Record<CheckStatus, string> = {
  pending: '⏳',
  ok: '✅',
  fail: '❌',
};

const LOOPBACK_FIX =
  'Run as admin: CheckNetIsolation.exe LoopbackExempt -a -n="Microsoft.Win32WebViewHost_cw5n1h2txyewy"';
const CERT_FIX = 'Run: npx office-addin-dev-certs install — then restart Excel';
const OLLAMA_FIX = 'Run: ollama serve — and ensure OLLAMA_ORIGINS=* (or your origin)';

export default function StartupSelfTest() {
  const [checks, setChecks] = useState<Check[]>(CHECKS_INITIAL);

  const update = (i: number, patch: Partial<Check>) =>
    setChecks(prev => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  useEffect(() => {
    // Check 0 — cert: if we rendered, the HTTPS page loaded — cert is trusted.
    update(0, { status: 'ok', detail: `Loaded from ${window.location.origin}` });

    // Check 1 — loopback: fetch our own origin to confirm AppContainer loopback exemption.
    // A 404 from the dev server still proves loopback works; only a network error means it's blocked.
    fetch(`${window.location.origin}/`, { signal: AbortSignal.timeout(4000) })
      .then(() => update(1, { status: 'ok', detail: `${window.location.origin} reachable` }))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        update(1, {
          status: 'fail',
          detail: `Network error — loopback may be blocked (${msg}). ${LOOPBACK_FIX}`,
        });
      });

    // Check 2 — Ollama: http loopback to :11434. Mixed-content is exempt for localhost in WebView2.
    fetch('http://localhost:11434/api/version', { signal: AbortSignal.timeout(4000) })
      .then(r => r.json())
      .then((data: { version?: string }) =>
        update(2, { status: 'ok', detail: `Ollama ${data.version ?? '(running)'}` })
      )
      .catch(() =>
        update(2, {
          status: 'fail',
          detail: `Not reachable. ${OLLAMA_FIX}`,
        })
      );
  }, []);

  const allDone = checks.every(c => c.status !== 'pending');
  const allOk = checks.every(c => c.status === 'ok');
  const anyFail = checks.some(c => c.status === 'fail');

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Body1Strong>Startup self-test</Body1Strong>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {checks.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 16, lineHeight: '20px', flexShrink: 0 }}>
              {c.status === 'pending' ? <Spinner size="tiny" /> : statusIcon[c.status]}
            </span>
            <div>
              <Body1Strong>{c.label}</Body1Strong>
              {c.detail && (
                <Caption1
                  style={{
                    display: 'block',
                    marginTop: 2,
                    color: c.status === 'fail' ? tokens.colorPaletteRedForeground1 : tokens.colorNeutralForeground3,
                  }}
                >
                  {c.detail}
                </Caption1>
              )}
            </div>
          </div>
        ))}
      </div>

      {allDone && allOk && (
        <MessageBar intent="success">
          <MessageBarBody>All checks passed — environment ready.</MessageBarBody>
        </MessageBar>
      )}
      {allDone && anyFail && (
        <MessageBar intent="warning">
          <MessageBarBody>
            One or more checks failed. Fix the issues above, then reload the pane (Ctrl+Shift+I →
            reload, or close and reopen the add-in).
          </MessageBarBody>
        </MessageBar>
      )}
      {!allDone && (
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Running checks…</Caption1>
      )}

      <div
        style={{
          marginTop: 8,
          padding: '10px 12px',
          background: tokens.colorNeutralBackground2,
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        <Body1Strong>Re-run fix commands</Body1Strong>
        <pre style={{ margin: '4px 0 0', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {`# If cert fails:\n${CERT_FIX}\n\n# If loopback fails:\n${LOOPBACK_FIX}\n\n# If Ollama fails:\n${OLLAMA_FIX}`}
        </pre>
      </div>
    </div>
  );
}
