import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './shell/tokens.css';
import './shell/base.css';
import { SystemReport } from './apps/system-report/SystemReport';

/**
 * Entry point.
 *
 * M0 mounts the System Report directly. From M1 this mounts the desktop shell, and the System
 * Report becomes the About/Stats app inside it.
 */
const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <SystemReport />
  </StrictMode>,
);
