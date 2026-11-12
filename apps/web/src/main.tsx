import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { applyInitialLang } from './shared/i18n/lang';
import { applyInitialTheme } from './shared/theme/theme';
import './shared/styles/tokens.css';
import './shared/styles/base.css';
import './features/ops/ops.css';

applyInitialTheme();
applyInitialLang();

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
