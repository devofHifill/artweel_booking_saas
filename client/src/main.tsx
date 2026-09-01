import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { adoptSupportTokenFromUrl } from './lib/api';
import { captureAttribution } from './lib/attribution';
import { applyStoredThemeEarly } from './lib/theme';
import { applyCachedBrandEarly } from './lib/brand';
import App from './App';
import './styles.css';

/*
  FIRST, before anything reads a token.

  A platform operator opening a support session (S7) arrives with the grant in
  the URL fragment. This takes it, stores it for this tab only, and strips it
  from the address bar — and it has to happen before the first API call, because
  `tokens.access` is consulted by it.
*/
adoptSupportTokenFromUrl();

// Before anything renders, so a landing URL is recorded even if the visitor
// navigates away immediately.
captureAttribution();

/*
  The theme pack: how the PRODUCT is shaped, chosen once for everybody.

  A build-time value, not a setting. It is not per studio — studios move their
  accent and nothing else, which is the boundary `brand.test.ts` guards — and
  it is not per person either, so there is nothing to store, fetch or
  invalidate. Baking it in also means no attribute swap after mount, and so no
  frame where the product is a different shape than it settles on.

  `artweel` is the default and emits nothing; the packs live in
  `styles.css` under `[data-pack]`, mirrored from `server/src/lib/design-tokens.ts`
  and checked against it by `tests/design/packs.test.ts`.
*/
const pack = import.meta.env.VITE_THEME_PACK;
if (pack && pack !== 'artweel') {
  document.documentElement.dataset.pack = pack;
}

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
