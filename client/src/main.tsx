import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { captureAttribution } from './lib/attribution';
import { applyStoredThemeEarly } from './lib/theme';
import App from './App';
import './styles.css';

// Before anything renders, so a landing URL is recorded even if the visitor
// navigates away immediately.
captureAttribution();

// Before the first paint: otherwise the page renders in the system theme and
// corrects itself once React mounts, which is a white flash on every load for
// anyone who chose dark.
applyStoredThemeEarly();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
