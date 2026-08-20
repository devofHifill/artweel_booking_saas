import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { captureAttribution } from './lib/attribution';
import { applyStoredThemeEarly } from './lib/theme';
import { applyCachedBrandEarly } from './lib/brand';
import App from './App';
import './styles.css';

// Before anything renders, so a landing URL is recorded even if the visitor
// navigates away immediately.
captureAttribution();

// Before the first paint: otherwise the page renders in the system theme and
// corrects itself once React mounts, which is a white flash on every load for
// anyone who chose dark.
applyStoredThemeEarly();

// Same reasoning, one layer up: the last known accent for this studio, painted
// before the first frame. The authoritative value arrives with the first API
// call a moment later, and a stale accent for that moment is invisible in a way
// that a clay-to-brand repaint on every page load is not.
applyCachedBrandEarly();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
