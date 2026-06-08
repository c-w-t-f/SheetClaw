import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import StartupSelfTest from './components/StartupSelfTest';

export default function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <StartupSelfTest />
    </FluentProvider>
  );
}
