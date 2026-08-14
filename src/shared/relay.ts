// Same-origin WebSocket transport, used in place of WebRTC when the page is
// served by the dev server (which runs the relay). It has no NAT traversal,
// no STUN/TURN and no inbound firewall requirement: the phone already reached
// this origin to load the page, so it can always reach it again for a socket.
//
// PeerJS stays as the fallback for static hosting, where no relay exists.

type Ev = 'data' | 'open' | 'close' | 'error';

/** The slice of a PeerJS DataConnection the game actually uses. */
export type Conn = {
  readonly open: boolean;
  send(msg: unknown): void;
  close(): void;
  on(ev: Ev, fn: (d?: unknown) => void): void;
  /** True when bytes are still queued — sending more would only add latency. */
  busy?(): boolean;
};

type RelayConn = Conn & { emit(ev: Ev, d?: unknown): void; setOpen(v: boolean): void };

function makeConn(send: (msg: unknown) => void, close: () => void): RelayConn {
  const hs: Partial<Record<Ev, ((d?: unknown) => void)[]>> = {};
  let isOpen = false;
  return {
    get open(): boolean { return isOpen; },
    setOpen(v: boolean): void { isOpen = v; },
    send,
    close,
    on(ev: Ev, fn: (d?: unknown) => void): void { (hs[ev] ??= []).push(fn); },
    emit(ev: Ev, d?: unknown): void { for (const fn of hs[ev] ?? []) fn(d); },
  };
}

/**
 * Where the relay lives. In dev it is part of the dev server, on the same
 * origin. A published build has no server of its own, so it needs an explicit
 * address supplied at build time via VITE_RELAY_URL.
 */
function relayBase(): string | undefined {
  const configured = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  if (!import.meta.env.DEV) return undefined;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
}

function relayUrl(params: Record<string, string>): string {
  return `${relayBase()}/relay?${new URLSearchParams(params).toString()}`;
}

const DIAL_MS = 2500;

/**
 * Without a relay both ends fall back to WebRTC, which needs a TURN server to
 * cross networks — and as of Aug 2026 neither PeerJS's bundled relays nor the
 * public Open Relay ones return any relay candidates at all. So on a static
 * host WITHOUT VITE_RELAY_URL set, phones frequently cannot connect.
 */
export const relayAvailable = (): boolean => relayBase() !== undefined;

/**
 * Host end. Resolves once the relay accepts us; rejects (so the caller can
 * fall back to PeerJS) if there is no relay on this origin.
 */
export function relayHost(code: string, onConnection: (c: Conn) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!relayAvailable()) { reject(); return; }
    let ws: WebSocket;
    try { ws = new WebSocket(relayUrl({ room: code, role: 'host' })); } catch { reject(); return; }
    const conns = new Map<string, ReturnType<typeof makeConn>>();
    const giveUp = setTimeout(() => { ws.close(); reject(); }, DIAL_MS);

    ws.onopen = () => { clearTimeout(giveUp); resolve(); };
    ws.onerror = () => { clearTimeout(giveUp); reject(); };
    ws.onclose = () => { for (const c of conns.values()) { c.setOpen(false); c.emit('close'); } };
    ws.onmessage = (ev) => {
      const env = JSON.parse(ev.data as string) as { from: string; t: string; msg?: unknown };
      if (env.t === 'open') {
        const c = makeConn(
          (msg) => ws.send(JSON.stringify({ to: env.from, msg })),
          () => ws.send(JSON.stringify({ to: env.from, msg: { t: '__close' } })),
        );
        c.setOpen(true);
        conns.set(env.from, c);
        onConnection(c);
      } else if (env.t === 'msg') {
        conns.get(env.from)?.emit('data', env.msg);
      } else if (env.t === 'close') {
        const c = conns.get(env.from);
        conns.delete(env.from);
        c?.setOpen(false);
        c?.emit('close');
      }
    };
  });
}

/** Controller end. Rejects when this origin has no relay. */
export function relayController(code: string): Promise<Conn> {
  return new Promise((resolve, reject) => {
    if (!relayAvailable()) { reject(); return; }
    let ws: WebSocket;
    const id = Math.random().toString(36).slice(2);
    try { ws = new WebSocket(relayUrl({ room: code, role: 'ctrl', id })); } catch { reject(); return; }
    const conn = makeConn((msg) => ws.send(JSON.stringify(msg)), () => ws.close());
    conn.busy = (): boolean => ws.bufferedAmount > 0;
    const giveUp = setTimeout(() => { ws.close(); reject(); }, DIAL_MS);

    ws.onopen = () => {
      clearTimeout(giveUp);
      conn.setOpen(true);
      resolve(conn);
      conn.emit('open');
    };
    ws.onerror = () => { clearTimeout(giveUp); reject(); };
    ws.onclose = () => { conn.setOpen(false); conn.emit('close'); };
    ws.onmessage = (ev) => {
      const env = JSON.parse(ev.data as string) as { t: string; msg?: unknown };
      if (env.t === 'msg') conn.emit('data', env.msg);
    };
  });
}
