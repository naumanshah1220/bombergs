// Message protocol between controller (phone) and host (PC), plus room-code
// helpers. This module must stay dependency-free: it is imported by both sides.

export type AbilityId = 'blink' | 'dash' | 'shield';

/** Controller → Host */
export type C2H =
  | { t: 'hello'; name: string; reclaim?: string }
  | { t: 'input'; steer: number; tap: boolean }
  | { t: 'draftPick'; index: 0 | 1 | 2 };

/** Host → Controller */
export type H2C =
  | { t: 'welcome'; slot: number; color: string; slotToken: string }
  | { t: 'phase'; phase: 'lobby' | 'calibrate' | 'play' | 'draft' | 'gameover' }
  | { t: 'bomb'; carrying: boolean; fuseFrac: number }
  | { t: 'draftOffer'; options: AbilityId[] }
  | { t: 'status'; alive: boolean; placement?: number; score: number };

/** 8 player colors, index = slot. */
export const PLAYER_COLORS = [
  '#FF5A5F', '#FFB400', '#3DDC84', '#29B6F6',
  '#AB47BC', '#FF7043', '#EC407A', '#8D6E63',
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
