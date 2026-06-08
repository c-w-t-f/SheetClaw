import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from '../store/index';

Office.onReady(() => {
  // Hydrate persisted config and auth before first render
  useStore.getState().loadConfigFromStorage();
  useStore.getState().loadAuthFromStorage();

  const container = document.getElementById('root');
  if (!container) throw new Error('Root element not found');
  createRoot(container).render(<App />);
});
