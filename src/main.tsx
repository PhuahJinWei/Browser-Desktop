import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './shell/tokens.css';
import './shell/base.css';
import { Shell } from './shell/Shell';

/**
 * Entry point. Everything past here is the desktop.
 */
const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
