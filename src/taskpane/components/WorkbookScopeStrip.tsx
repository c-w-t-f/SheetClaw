import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Caption1,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import type { WorkbookHandle } from '../../types';
import { getTaskpaneWorkbookLayer } from '../workbookLayer';

type LoadState =
  | { status: 'loading'; workbook: null; error: '' }
  | { status: 'ready'; workbook: WorkbookHandle; error: '' }
  | { status: 'error'; workbook: null; error: string };

export default function WorkbookScopeStrip() {
  const [state, setState] = useState<LoadState>({ status: 'loading', workbook: null, error: '' });

  const refresh = useCallback(async () => {
    setState({ status: 'loading', workbook: null, error: '' });
    try {
      const [workbook] = await getTaskpaneWorkbookLayer().registry.refresh();
      setState({ status: 'ready', workbook, error: '' });
    } catch (e) {
      setState({
        status: 'error',
        workbook: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div style={{
      flexShrink: 0,
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: 8,
      alignItems: 'center',
      padding: '6px 12px',
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
      background: tokens.colorNeutralBackground2,
    }}>
      <div style={{ minWidth: 0 }}>
        {state.status === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Spinner size="extra-small" />
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Loading workbook...</Caption1>
          </div>
        )}
        {state.status === 'ready' && (
          <Caption1
            title={state.workbook.name}
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: tokens.colorNeutralForeground2,
            }}
          >
            {state.workbook.name} - host workbook
          </Caption1>
        )}
        {state.status === 'error' && (
          <Caption1
            title={state.error}
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: tokens.colorPaletteRedForeground1,
            }}
          >
            Workbook unavailable
          </Caption1>
        )}
      </div>
      <Button size="small" appearance="subtle" onClick={() => void refresh()}>
        Refresh
      </Button>
    </div>
  );
}
