import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './components/AuthGate';
import { LanguageProvider } from './components/LanguageContext';
import ErrorBoundary from './components/ErrorBoundary';
import { initTelemetry } from './services/telemetry';
import './index.css';

// Install global crash/rejection handlers + (DSN-gated) crash reporter before render.
initTelemetry();

// In playtest the app is served under Vite base `/creator/` (single-origin
// tunnel); the router must know that prefix. `/` for normal dev.
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <BrowserRouter basename={BASENAME} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // BASE_URL, not '/': in playtest/tunnel mode creator-web is served under
    // `/creator/` on the same origin as play-web, so a hardcoded '/sw.js'
    // registered the *participant* app's worker (and a scope we don't own).
    const base = import.meta.env.BASE_URL || '/';
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => undefined);
  });
}
