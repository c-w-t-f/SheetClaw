import { useState } from 'react';
import {
  FluentProvider,
  Tab,
  TabList,
  webLightTheme,
  type SelectTabData,
} from '@fluentui/react-components';
import ChatPanel from './components/ChatPanel';
import UsageDashboard from './components/UsageDashboard';
import SettingsPanel from './components/SettingsPanel';
import Footer from './components/Footer';

type TabId = 'chat' | 'usage' | 'settings';

export default function App() {
  const [tab, setTab] = useState<TabId>('chat');

  return (
    <FluentProvider theme={webLightTheme} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab nav */}
      <TabList
        selectedValue={tab}
        onTabSelect={(_, d: SelectTabData) => setTab(d.value as TabId)}
        style={{ flexShrink: 0, paddingLeft: 8, borderBottom: `1px solid ${webLightTheme.colorNeutralStroke1}` }}
        size="small"
      >
        <Tab value="chat">Chat</Tab>
        <Tab value="usage">Usage</Tab>
        <Tab value="settings">Settings</Tab>
      </TabList>

      {/* Active surface */}
      <div style={{ flex: 1, minHeight: 0, height: '100%' }}>
        {tab === 'chat'     && <ChatPanel />}
        {tab === 'usage'    && <UsageDashboard />}
        {tab === 'settings' && <SettingsPanel />}
      </div>

      {/* Persistent footer */}
      <Footer />
    </FluentProvider>
  );
}
