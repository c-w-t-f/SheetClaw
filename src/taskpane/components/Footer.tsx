import { Caption1, tokens } from '@fluentui/react-components';
import { useStore } from '../../store/index';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export default function Footer() {
  const totals = useStore(s => s.sessionTotals);
  const session = useStore(s => s.currentSession);

  if (!totals && !session) return null;

  const tokens_ = totals ? totals.inputTokens + totals.outputTokens : 0;
  const cost = totals?.costUsd ?? 0;
  const model = session?.model ?? '';
  const budget = session?.tokenBudget;
  const usedPct = budget && budget.window > 0 ? (budget.used / budget.window) * 100 : null;

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '4px 12px',
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
      background: tokens.colorNeutralBackground2,
      flexShrink: 0,
    }}>
      <Caption1 style={{ color: tokens.colorNeutralForeground3, fontFamily: 'monospace' }}>
        ◷ {fmtTokens(tokens_)} tok
        {cost > 0 ? ` · ~$${cost.toFixed(4)}` : ''}
      </Caption1>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {usedPct !== null && usedPct > 70 && (
          <Caption1 style={{ color: usedPct > 90 ? tokens.colorPaletteRedForeground1 : tokens.colorPaletteYellowForeground1 }}>
            {Math.round(usedPct)}% ctx
          </Caption1>
        )}
        {model && (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{model}</Caption1>
        )}
      </div>
    </div>
  );
}
