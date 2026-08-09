import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

// Phone motion sensors require a secure context, and phones reach us via LAN
// IP (not localhost) — so real-phone testing uses `npm run dev:phone` (HTTPS,
// self-signed). Plain `npm run dev` stays HTTP for desktop/sim work, where
// localhost already counts as secure.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'phone' ? [basicSsl()] : [],
  server: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      input: {
        host: resolve(__dirname, 'index.html'),
        controller: resolve(__dirname, 'controller.html'),
      },
    },
  },
}));
