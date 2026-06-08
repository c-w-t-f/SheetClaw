import { FluentProvider, webLightTheme, Divider } from '@fluentui/react-components';
import StartupSelfTest from './components/StartupSelfTest';
import HarnessPanel from './components/HarnessPanel';

export default function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <StartupSelfTest />
      <Divider />
      <HarnessPanel />
    </FluentProvider>
  );
}
