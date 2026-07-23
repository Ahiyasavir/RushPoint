import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Tunnel hosts allowed to reach the dev/preview server (npm run playtest*).
const TUNNEL_HOSTS = ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'];

// ⚠ The playtest build MUST NOT write the directory the gate build writes
// (change: playtest-build-isolation). play-web's base is `/` in both modes, so the
// hazard here is not the base, it is the BACKEND: isEmulatorBuild
// (packages/shared/src/env.ts) is `DEV || MODE === 'playtest'`, so only the
// `--mode playtest` bundle keeps the local-emulator wiring that lets a real phone
// on the tunnel talk to the local backend. `npm run play:build` (inside
// `npm run verify`) builds mode `production`; landing that in the served directory
// silently points participants' phones at real Firebase, where anonymous auth is
// disabled (auth/admin-restricted-operation) and nobody can join. Separate outDirs
// make that collision impossible. `npm run bundle:budget` keeps measuring `dist`,
// which is still exactly the `npm run play:build` output.
export default defineConfig(({ mode }) => ({
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
    port: 5181,
    // Allow tunnel hosts (npm run playtest / playtest:ngrok) to reach the dev server.
    allowedHosts: TUNNEL_HOSTS,
  },
  // `vite preview` serves the production build. The always-on playtest host uses
  // this (npm run playtest:prod) instead of the dev server: pre-built + minified,
  // ~10 requests instead of hundreds — dramatically faster over the tunnel.
  preview: {
    port: 5181,
    host: true,
    strictPort: true,
    allowedHosts: TUNNEL_HOSTS,
  },
}));
