import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import ChatPanel from './components/ChatPanel';

export default function App() {
  return (
    <FluentProvider theme={webLightTheme} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ChatPanel />
    </FluentProvider>
  );
}
