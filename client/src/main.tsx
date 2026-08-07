import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { captureAttribution } from './lib/attribution';
import App from './App';
import './styles.css';

// Before anything renders, so a landing URL is recorded even if the visitor
// navigates away immediately.
captureAttribution();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
