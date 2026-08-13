import { spawn, type ChildProcess } from 'node:child_process';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * Runs a Cloudflare quick tunnel alongside the dev server and tells the lobby
 * its address via GET /__tunnel.
 *
 * Phones need this for two reasons a LAN IP cannot cover: the tunnel is HTTPS
 * (a secure origin, which mobile browsers require before they will hand a page
 * the full WebRTC/sensor APIs), and it is reachable without punching the dev
 * server through the Windows firewall.
 *
 * Quick tunnels mint a new random hostname on every run and die with the
 * process, so hardcoding or bookmarking one always ends in a dead link — the
 * lobby therefore asks for the current address at render time instead.
 *
 * Set NO_TUNNEL=1 to skip it (offline work, or faster restarts).
 */
export function cloudflareTunnel(): Plugin {
  let url: string | undefined;
  let child: ChildProcess | undefined;
  let failure: string | undefined;

  return {
    name: 'bombergs-cloudflare-tunnel',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__tunnel', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ url: url ?? null, error: failure ?? null }));
      });

      if (process.env.NO_TUNNEL === '1') {
        failure = 'disabled by NO_TUNNEL=1';
        return;
      }

      const port = server.config.server.port ?? 5173;
      child = spawn('npx', ['-y', 'cloudflared', 'tunnel', '--url', `http://localhost:${port}`], {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const scan = (buf: Buffer): void => {
        if (url) return;
        const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buf));
        if (!found) return;
        url = found[0];
        server.config.logger.info(`\n  ➜  Phone (tunnel):  ${url}\n`);
      };
      child.stdout?.on('data', scan);
      child.stderr?.on('data', scan);
      child.on('error', (err) => { failure = String(err.message); });
      child.on('exit', (code) => {
        if (!url) failure = `cloudflared exited (${code}) before printing a URL`;
        url = undefined;
      });

      const stop = (): void => { child?.kill(); child = undefined; };
      server.httpServer?.on('close', stop);
      process.once('exit', stop);
    },
  };
}
