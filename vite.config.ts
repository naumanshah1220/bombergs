import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

type NetHost = { label: string; host: string };

/**
 * Every address a phone could plausibly reach this machine on, best first, so
 * the lobby can offer them as alternative join links instead of guessing.
 *
 * Tailscale (100.64.0.0/10) matters because it is the only one that survives
 * the phone being on mobile data: both ends get a tailnet address, so the page
 * loads AND the WebRTC data channel finds a route.
 */
function netHosts(): NetHost[] {
  const out: NetHost[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      if (ni.address.startsWith('169.254.')) continue; // link-local: never routable
      const [a, b] = ni.address.split('.').map(Number);
      const tailscale = a === 100 && b >= 64 && b <= 127;
      out.push({
        label: tailscale ? 'Tailscale'
          : /wi-?fi|wlan/i.test(name) ? 'Wi-Fi'
          : ni.address.startsWith('192.168.137.') ? 'PC hotspot'
          : name,
        host: ni.address,
      });
    }
  }
  const score = (h: NetHost) =>
    h.label === 'Tailscale' ? 5
    : h.host.startsWith('192.168.137.') ? 1 // Windows hotspot/ICS — rarely the real Wi-Fi
    : h.host.startsWith('192.168.') ? 4
    : h.host.startsWith('10.') ? 3
    : /^172\.(1[6-9]|2\d|3[01])\./.test(h.host) ? 2
    : 0;
  return out.sort((x, y) => score(y) - score(x));
}

// Phone motion sensors require a secure context, and phones reach us via LAN
// IP (not localhost) — so real-phone testing uses `npm run dev:phone` (HTTPS,
// self-signed). Plain `npm run dev` stays HTTP for desktop/sim work, where
// localhost already counts as secure.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'phone' ? [basicSsl()] : [],
  define: {
    __LAN_HOST__: JSON.stringify(netHosts().find((h) => h.label !== 'Tailscale')?.host ?? null),
    __NET_HOSTS__: JSON.stringify(netHosts()),
  },
  // allowedHosts: vite rejects unknown Host headers. Tunnel hostnames are
  // random per run, and `tailscale serve` fronts us on <machine>.<tailnet>.ts.net.
  server: { host: true, port: 5173, allowedHosts: ['.trycloudflare.com', '.ts.net'] },
  build: {
    rollupOptions: {
      input: {
        host: resolve(__dirname, 'index.html'),
        controller: resolve(__dirname, 'controller.html'),
      },
    },
  },
}));
