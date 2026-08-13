import { WebSocketServer, type WebSocket } from 'ws';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * A dumb message relay on the dev server, at ws://<same-origin>/relay.
 *
 * The phone already loads the page from this server, so a socket back to the
 * same origin is guaranteed to reach it — no NAT traversal, no STUN/TURN, no
 * firewall rule, and immune to router client-isolation. WebRTC has none of
 * those guarantees, which is why it kept failing on phones while two tabs on
 * the PC connected fine.
 *
 * The relay never inspects payloads; it only routes between the one host of a
 * room and its controllers, keyed by the room code.
 */
type Room = { host?: WebSocket; controllers: Map<string, WebSocket> };

export function relayServer(): Plugin {
  return {
    name: 'bombergs-relay',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const rooms = new Map<string, Room>();
      const wss = new WebSocketServer({ noServer: true });
      const roomOf = (code: string): Room => {
        let r = rooms.get(code);
        if (!r) rooms.set(code, (r = { controllers: new Map() }));
        return r;
      };
      const send = (ws: WebSocket | undefined, obj: unknown): void => {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
      };

      wss.on('connection', (ws: WebSocket, code: string, role: string, id: string) => {
        const room = roomOf(code);
        server.config.logger.info(`  relay: ${role} joined room ${code}`);
        if (role === 'host') {
          room.host?.close();
          room.host = ws;
          // Controllers that arrived before the host page was ready still count.
          for (const cid of room.controllers.keys()) send(ws, { from: cid, t: 'open' });
        } else {
          room.controllers.set(id, ws);
          send(room.host, { from: id, t: 'open' });
        }

        ws.on('message', (raw) => {
          const text = String(raw);
          if (role === 'host') {
            // { to, msg } — routed to one controller
            const env = JSON.parse(text) as { to: string; msg: unknown };
            send(room.controllers.get(env.to), { t: 'msg', msg: env.msg });
          } else {
            send(room.host, { from: id, t: 'msg', msg: JSON.parse(text) });
          }
        });

        ws.on('close', () => {
          if (role === 'host') {
            if (room.host === ws) room.host = undefined;
          } else {
            room.controllers.delete(id);
            send(room.host, { from: id, t: 'close' });
          }
          if (!room.host && !room.controllers.size) rooms.delete(code);
        });
      });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/relay') return; // leave Vite's own HMR socket alone
        const code = (url.searchParams.get('room') ?? '').toUpperCase();
        const role = url.searchParams.get('role') === 'host' ? 'host' : 'ctrl';
        const id = url.searchParams.get('id') ?? Math.random().toString(36).slice(2);
        if (!code) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket as never, head, (ws) => {
          wss.emit('connection', ws, code, role, id);
        });
      });

      server.config.logger.info('  ➜  Relay:   ws://<origin>/relay (phones skip WebRTC)');
    },
  };
}
