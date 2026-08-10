import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

/**
 * Best-guess LAN IPv4 for the QR join URL, so scanning works even when the
 * host page was opened via localhost. Prefers home-router ranges over VPN /
 * hotspot adapters.
 */
function lanIp(): string | null {
  const all: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) all.push(ni.address);
    }
  }
  const score = (ip: string) =>
    ip.startsWith('192.168.137.') ? 1 // Windows hotspot/ICS — rarely the real Wi-Fi
    : ip.startsWith('192.168.') ? 4
    : ip.startsWith('10.') ? 3
    : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2
    : 0;
  return all.sort((a, b) => score(b) - score(a))[0] ?? null;
}

// Phone motion sensors require a secure context, and phones reach us via LAN
// IP (not localhost) — so real-phone testing uses `npm run dev:phone` (HTTPS,
// self-signed). Plain `npm run dev` stays HTTP for desktop/sim work, where
// localhost already counts as secure.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'phone' ? [basicSsl()] : [],
  define: { __LAN_HOST__: JSON.stringify(lanIp()) },
  // allowedHosts: vite rejects unknown Host headers; the tunnel hostname is
  // random per run, so allow the whole trycloudflare.com suffix.
  server: { host: true, port: 5173, allowedHosts: ['.trycloudflare.com'] },
  build: {
    rollupOptions: {
      input: {
        host: resolve(__dirname, 'index.html'),
        controller: resolve(__dirname, 'controller.html'),
      },
    },
  },
}));
