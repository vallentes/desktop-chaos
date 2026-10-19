import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './store';

createRoot(document.getElementById('root')!).render(
  <StoreProvider>
    <App />
  </StoreProvider>,
);
