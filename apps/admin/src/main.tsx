import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import AuthGate from './components/AuthGate';
import ErrorBoundary from './components/ErrorBoundary';
import { LanguageProvider } from './i18n';
import { RoleProvider } from './roles';
import { initTelemetry } from './services/telemetry';
import './index.css';

initTelemetry();

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <RoleProvider>
            <BrowserRouter>
              <AuthGate>
                <App />
              </AuthGate>
            </BrowserRouter>
          </RoleProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Register the app-shell service worker for installability + offline loading.
// Production only: in dev it would cache stale bundles and shadow Vite HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[RushPoint] service worker registration failed:', err);
    });
  });
}
