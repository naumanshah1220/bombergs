// Message protocol between controller (phone) and host (PC), plus room-code
// helpers. This module must stay dependency-free: it is imported by both sides.

export type AbilityId = 'blink' | 'dash' | 'shield';

/** Controller → Host */
export type C2H =
  | { t: 'hello'; name: string; reclaim?: string }
  // throttle: 0..1 in gas-pedal mode; move: joystick vector in stick mode;
  // both absent = auto-drive
  | { t: 'input'; steer: number; tap: boolean; throttle?: number; move?: { x: number; y: number } }
  | { t: 'draftPick'; index: 0 | 1 | 2 };

/** Host → Controller */
export type H2C =
  | { t: 'welcome'; slot: number; color: string; slotToken: string }
  | { t: 'phase'; phase: 'lobby' | 'calibrate' | 'play' | 'draft' | 'gameover' }
  | { t: 'bomb'; carrying: boolean; fuseFrac: number }
  | { t: 'ability'; id: AbilityId }               // picked up a crate on the map
  | { t: 'draftOffer'; options: AbilityId[] }
  | { t: 'status'; alive: boolean; placement?: number; score: number };

/**
 * ICE servers for both ends of the phone↔PC link.
 *
 * Passing `config` to the Peer constructor REPLACES PeerJS's default rather
 * than extending it, so this list has to stay complete. Dropping the TURN
 * entry removes the relay that carries the connection whenever the phone and
 * the PC cannot reach each other directly — the failure mode is a controller
 * stuck forever on "Connecting…", with no error anywhere. (Learned the hard
 * way: a STUN-only override here broke every join.)
 */
export const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
      username: 'peerjs',
      credential: 'peerjsp',
    },
  ],
  sdpSemantics: 'unified-plan',
};

/** 8 player colors, index = slot. */
export const PLAYER_COLORS = [
  '#FF5A5F', '#FFB400', '#3DDC84', '#29B6F6',
  '#AB47BC', '#FF7043', '#EC407A', '#00E5FF',
] as const;

/** Room-code alphabet: A–Z minus I and O (easily confused with 1 and 0). */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function roomCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
  return out;
}

/** PeerJS ids must be lowercase alphanumeric-ish; prefix avoids collisions. */
export function hostPeerId(code: string): string {
  return `bombergs-${code.toLowerCase()}`;
}

export function controllerUrl(origin: string, code: string): string {
  return `${origin}/controller.html?room=${code}`;
}
