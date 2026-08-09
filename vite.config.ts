import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

// HTTPS in dev because phone motion sensors require a secure context,
// and the phone reaches us via LAN IP (not localhost).
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      input: {
        host: resolve(__dirname, 'index.html'),
        controller: resolve(__dirname, 'controller.html'),
      },
    },
  },
});
