import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// `--mode playtest` serves creator-web under `/creator/` so a single tunnel
// origin can host both apps: every asset URL is prefixed `/creator/…` and the
// reverse proxy (scripts/proxy.mjs) routes that prefix to creator-web. Normal
// `dev:all` keeps base `/` (creator at http://localhost:5180/) unchanged.
export default defineConfig(({ mode }) => ({
  base: mode === 'playtest' ? '/creator/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@rushpoint/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    port: 5180,
    // Allow tunnel hosts (npm run playtest / playtest:ngrok) to reach the dev server.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
  },
}));
