import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Tunnel hosts allowed to reach the dev/preview server (npm run playtest*).
const TUNNEL_HOSTS = ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'];

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
    allowedHosts: TUNNEL_HOSTS,
  },
  // `vite preview` serves the production build. The always-on playtest host uses
  // this (npm run playtest:prod) instead of the dev server: pre-built + minified,
  // ~10 requests instead of hundreds — dramatically faster over the tunnel.
  preview: {
    port: 5180,
    host: true,
    strictPort: true,
    allowedHosts: TUNNEL_HOSTS,
  },
}));
