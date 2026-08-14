/**
 * Bombergs relay — Cloudflare Worker + Durable Object.
 *
 * One Durable Object instance per room code, so both ends of a room always
 * land on the same instance and routing needs no shared state. Mirrors the
 * dev server's /relay protocol exactly (see vite-relay-plugin.ts), so the
 * game client cannot tell which one it is talking to.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('bombergs relay: connect to /relay?room=CODE&role=host|ctrl', {
        headers: { 'content-type': 'text/plain' },
      });
    }
    if (url.pathname !== '/relay') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const room = (url.searchParams.get('room') ?? '').toUpperCase();
    if (!room) return new Response('missing room', { status: 400 });

    // Room code -> one instance. Everyone in a room shares it.
    const id = env.ROOM.idFromName(room);
    return env.ROOM.get(id).fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    this.host = null;
    this.controllers = new Map(); // id -> WebSocket
  }

  send(ws, obj) {
    if (ws && ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(JSON.stringify(obj));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'ctrl';
    const id = url.searchParams.get('id') ?? crypto.randomUUID();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    if (role === 'host') {
      // A reconnecting host replaces the old one; controllers stay put.
      if (this.host) try { this.host.close(); } catch { /* already gone */ }
      this.host = server;
      for (const cid of this.controllers.keys()) this.send(server, { from: cid, t: 'open' });
    } else {
      this.controllers.set(id, server);
      this.send(this.host, { from: id, t: 'open' });
    }

    server.addEventListener('message', (event) => {
      let parsed;
      try { parsed = JSON.parse(event.data); } catch { return; } // never trust the wire
      if (role === 'host') {
        this.send(this.controllers.get(parsed.to), { t: 'msg', msg: parsed.msg });
      } else {
        this.send(this.host, { from: id, t: 'msg', msg: parsed });
      }
    });

    const bye = () => {
      if (role === 'host') {
        if (this.host === server) this.host = null;
      } else {
        this.controllers.delete(id);
        this.send(this.host, { from: id, t: 'close' });
      }
    };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);

    return new Response(null, { status: 101, webSocket: client });
  }
}
