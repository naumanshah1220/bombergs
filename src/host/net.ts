// Host networking: owns the PeerJS peer, assigns slots, routes messages.

import Peer, { type DataConnection } from 'peerjs';
import {
  PLAYER_COLORS, hostPeerId, roomCode, type C2H, type H2C,
} from '../shared/protocol';

export type ControllerInfo = {
  slot: number;
  name: string;
  color: string;
  steer: number;
  tap: boolean;
  throttle?: number; // gas-pedal mode: 0..1; undefined = auto-drive
  connected: boolean;
  lastSeen: number;
};

export type RoomHandlers = {
  onJoin(c: ControllerInfo): void;
  onInput(slot: number, steer: number, tap: boolean): void;
  onDraftPick(slot: number, index: 0 | 1 | 2): void;
  onLeave(slot: number): void;
};

export type Room = {
  code: string;
  controllers: Map<number, ControllerInfo>;
  sendTo(slot: number, msg: H2C): void;
  broadcast(msg: H2C): void;
};

const HEARTBEAT_DROP_MS = 5000;

export function createRoom(handlers: RoomHandlers, onReady: (room: Room) => void, onError: (err: string) => void): void {
  const code = roomCode();
  const peer = new Peer(hostPeerId(code));
  const conns = new Map<number, DataConnection>();
  const tokens = new Map<string, number>(); // slotToken → slot, for reclaim
  const controllers = new Map<number, ControllerInfo>();

  const room: Room = {
    code,
    controllers,
    sendTo(slot, msg) { conns.get(slot)?.send(msg); },
    broadcast(msg) { for (const c of conns.values()) c.send(msg); },
  };

  peer.on('open', () => onReady(room));
  peer.on('error', (err) => {
    // 'unavailable-id' = room code collision → just retry with a fresh code
    if (err.type === 'unavailable-id') createRoom(handlers, onReady, onError);
    else onError(`Network error: ${err.type}`);
  });

  peer.on('connection', (conn) => {
    let slot = -1;
    conn.on('data', (raw) => {
      const msg = raw as C2H;
      if (msg.t === 'hello') {
        const reclaimed = msg.reclaim != null ? tokens.get(msg.reclaim) : undefined;
        slot = reclaimed ?? nextFreeSlot(controllers);
        if (slot === -1) { conn.close(); return; }
        const token = crypto.getRandomValues(new Uint32Array(2)).join('-');
        tokens.set(token, slot);
        conns.get(slot)?.close();
        conns.set(slot, conn);
        const info: ControllerInfo = {
          slot, name: msg.name, color: PLAYER_COLORS[slot],
          steer: 0, tap: false, connected: true, lastSeen: Date.now(),
        };
        controllers.set(slot, info);
        conn.send({ t: 'welcome', slot, color: info.color, slotToken: token } satisfies H2C);
        handlers.onJoin(info);
      } else if (msg.t === 'input' && slot >= 0) {
        const c = controllers.get(slot);
        if (!c) return;
        c.steer = Math.max(-1, Math.min(1, msg.steer));
        c.tap = msg.tap;
        c.throttle = msg.throttle === undefined ? undefined : Math.max(0, Math.min(1, msg.throttle));
        c.lastSeen = Date.now();
        if (!c.connected) { c.connected = true; handlers.onJoin(c); } // self-heal after a hiccup
        handlers.onInput(slot, c.steer, c.tap);
      } else if (msg.t === 'draftPick' && slot >= 0) {
        handlers.onDraftPick(slot, msg.index);
      }
    });
    conn.on('close', () => markDisconnected());
    conn.on('error', () => markDisconnected());
    function markDisconnected(): void {
      if (slot < 0) return;
      const c = controllers.get(slot);
      if (c) { c.connected = false; c.steer = 0; c.tap = false; }
      handlers.onLeave(slot);
    }
  });

  // Heartbeat sweep: a controller that stops sending input goes neutral.
  setInterval(() => {
    const now = Date.now();
    for (const c of controllers.values()) {
      if (c.connected && now - c.lastSeen > HEARTBEAT_DROP_MS) {
        c.connected = false;
        c.steer = 0;
        c.tap = false;
        handlers.onLeave(c.slot);
      }
    }
  }, 1000);
}

function nextFreeSlot(controllers: Map<number, ControllerInfo>): number {
  for (let i = 0; i < PLAYER_COLORS.length; i++) {
    if (!controllers.has(i) || !controllers.get(i)!.connected) return i;
  }
  return -1;
}
