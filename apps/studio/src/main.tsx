import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@ulpin/ui/styles.css';
import { startLocalData } from './local/start';
import { App } from './app/App';

await startLocalData();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
