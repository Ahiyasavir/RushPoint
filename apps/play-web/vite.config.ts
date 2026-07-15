import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Tunnel hosts allowed to reach the dev/preview server (npm run playtest*).
const TUNNEL_HOSTS = ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'];

export default defineConfig({
  plugins: [react()],
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
});
