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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
