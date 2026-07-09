import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
  },
});
