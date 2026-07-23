import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Tunnel hosts allowed to reach the dev/preview server (npm run playtest*).
const TUNNEL_HOSTS = ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'];

// `--mode playtest` serves creator-web under `/creator/` so a single tunnel
// origin can host both apps: every asset URL is prefixed `/creator/…` and the
// reverse proxy (scripts/proxy.mjs) routes that prefix to creator-web. Normal
// `dev:all` keeps base `/` (creator at http://localhost:5180/) unchanged.
//
// ⚠ The two modes MUST write different directories (change: playtest-build-isolation).
// The always-on playtest serves a PRE-BUILT bundle through `vite preview`. If the
// gate build (`npm run creator:build`, inside `npm run verify`) wrote the same
// directory, it would replace the live artifact with a base-`/` build: the proxy
// then hands every `/assets/*` request to play-web, which answers 200 with its own
// HTML, and the live creator console is a BLANK PAGE with no error anywhere. So the
// playtest build lands in `dist-playtest` and the gate keeps `dist`. See PLAYTEST.md.
export default defineConfig(({ mode }) => ({
  base: mode === 'playtest' ? '/creator/' : '/',
  plugins: [react()],
  build: {
    outDir: mode === 'playtest' ? 'dist-playtest' : 'dist',
  },
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
