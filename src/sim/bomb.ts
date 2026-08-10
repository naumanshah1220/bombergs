// The bomb state machine. Feel targets, from the references:
//  - Dota 2 Pass The Bomb: toss to pass at range, ~15s fuses (5s in fast
//    modes), blink mind-games.
//  - Roblox Bomb Tag: pass by TOUCH, the bomber runs faster than everyone.
// We hybridize: the carrier can throw at range (tap, must land to stick) AND
// pass by ramming someone — plus a speed boost that makes a cornered carrier
// genuinely dangerous.

import { TUNE } from './constants';
import { breakChunk, type Vec2 } from './floe';
import type { Penguin, World, WorldEvent } from './world';

export const BOMB = {
  IDLE_MS: 1500,        // breather before the skua appears
  SKUA_MS: 2200,        // delivery flight (the dread window)
  FUSE_MIN_MS: 12000,   // Dota normal is 15s; we run slightly hotter
  FUSE_MAX_MS: 18000,
  THROW_MS: 500,        // arc flight time
  PASS_RADIUS: 150,     // throw range (ring shown on the ice)
  STICK_RADIUS: 34,     // landing catch radius
  BLAST_RADIUS: 115,    // eliminates anyone this close to the boom
  NO_TAGBACK_MS: 1500,  // fresh carrier can't return to sender
};

export type BombState =
  | { s: 'idle'; t: number }
  | { s: 'delivering'; toSlot: number; t: number }
  | { s: 'carried'; slot: number; fuseMs: number; fuseTotal: number; prevSlot: number; noTagBackMs: number }
  | { s: 'flying'; fromSlot: number; from: Vec2; to: Vec2; t01: number; fuseMs: number; fuseTotal: number }
  | { s: 'ground'; pos: Vec2; fuseMs: number; fuseTotal: number };

export const idleBomb = (): BombState => ({ s: 'idle', t: 0 });

/** Fraction of the fuse burned, 0..1 — drives ticks, pulses, pufferiness. */
export function fuseFrac(b: BombState): number {
  if (b.s === 'carried' || b.s === 'flying' || b.s === 'ground') {
    return 1 - b.fuseMs / b.fuseTotal;
  }
  return 0;
}

export function carrierSlot(b: BombState): number | undefined {
  return b.s === 'carried' ? b.slot : undefined;
}

/** Current world position of the bomb, if it is anywhere physical. */
export function bombPos(w: World): Vec2 | undefined {
  const b = w.bomb;
  if (b.s === 'carried') {
    const p = w.penguins.find((q) => q.slot === b.slot);
    return p ? { ...p.pos } : undefined;
  }
  if (b.s === 'flying') {
    // parabolic arc handled by renderer; logical position lerps
    return {
      x: b.from.x + (b.to.x - b.from.x) * b.t01,
      y: b.from.y + (b.to.y - b.from.y) * b.t01,
    };
  }
  if (b.s === 'ground') return { ...b.pos };
  return undefined;
}

/** Carrier tap: throw at the nearest target inside PASS_RADIUS. */
export function tryThrow(w: World): boolean {
  const b = w.bomb;
  if (b.s !== 'carried') return false;
  const me = w.penguins.find((q) => q.slot === b.slot);
  if (!me) return false;
  const target = nearestTarget(w, me, b.noTagBackMs > 0 ? b.prevSlot : undefined, BOMB.PASS_RADIUS);
  if (!target) return false;
  w.bomb = {
    s: 'flying',
    fromSlot: b.slot,
    from: { ...me.pos },
    to: { ...target.pos },
    t01: 0,
    fuseMs: b.fuseMs,
    fuseTotal: b.fuseTotal,
  };
  return true;
}

function nearestTarget(w: World, me: Penguin, excludeSlot: number | undefined, range: number): Penguin | undefined {
  let best: Penguin | undefined;
  let bestD = range;
  for (const p of w.penguins) {
    if (!p.alive || p.slot === me.slot || p.slot === excludeSlot) continue;
    const d = Math.hypot(p.pos.x - me.pos.x, p.pos.y - me.pos.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

export function bombStep(w: World, dtMs: number, rand: () => number = Math.random): WorldEvent[] {
  const events: WorldEvent[] = [];
  const b = w.bomb;
  const alive = w.penguins.filter((p) => p.alive);

  // carrier speed boost bookkeeping
  const carrier = carrierSlot(w.bomb);
  for (const p of w.penguins) p.speedMult = p.slot === carrier ? TUNE.CARRIER_SPEED_MULT : 1;

  switch (b.s) {
    case 'idle': {
      b.t += dtMs;
      if (b.t >= BOMB.IDLE_MS && alive.length > 1) {
        const target = alive[Math.floor(rand() * alive.length)];
        w.bomb = { s: 'delivering', toSlot: target.slot, t: 0 };
        events.push({ kind: 'delivered', slot: target.slot });
      }
      break;
    }
    case 'delivering': {
      b.t += dtMs;
      const target = w.penguins.find((p) => p.slot === b.toSlot);
      if (!target?.alive) { w.bomb = idleBomb(); break; } // mark drowned mid-flight
      if (b.t >= BOMB.SKUA_MS) {
        const fuseTotal = BOMB.FUSE_MIN_MS + rand() * (BOMB.FUSE_MAX_MS - BOMB.FUSE_MIN_MS);
        w.bomb = { s: 'carried', slot: b.toSlot, fuseMs: fuseTotal, fuseTotal, prevSlot: -1, noTagBackMs: 0 };
        events.push({ kind: 'stick', slot: b.toSlot });
      }
      break;
    }
    case 'carried': {
      b.fuseMs -= dtMs;
      b.noTagBackMs = Math.max(0, b.noTagBackMs - dtMs);
      const me = w.penguins.find((p) => p.slot === b.slot);
      if (!me?.alive) { w.bomb = idleBomb(); break; } // carrier drowned; skua re-delivers
      if (b.fuseMs <= 0) {
        explode(w, { ...me.pos }, events);
        break;
      }
      if (me.tap) {
        me.tap = false;
        if (tryThrow(w)) events.push({ kind: 'throw', slot: me.slot });
        else events.push({ kind: 'honk', slot: me.slot });
        break;
      }
      // Roblox-style contact pass: ram someone to hand it over
      const exclude = b.noTagBackMs > 0 ? b.prevSlot : undefined;
      const touch = nearestTarget(w, me, exclude, TUNE.PENGUIN_RADIUS * 2.15);
      if (touch) {
        w.bomb = {
          s: 'carried', slot: touch.slot, fuseMs: b.fuseMs, fuseTotal: b.fuseTotal,
          prevSlot: b.slot, noTagBackMs: BOMB.NO_TAGBACK_MS,
        };
        events.push({ kind: 'stick', slot: touch.slot });
      }
      break;
    }
    case 'flying': {
      b.fuseMs -= dtMs;
      b.t01 += dtMs / BOMB.THROW_MS;
      if (b.fuseMs <= 0) {
        const at = bombPos(w);
        if (at) explode(w, at, events);
        break;
      }
      if (b.t01 >= 1) {
        // must LAND to stick: whoever is under it now — dodgeable, and the
        // thrower can absolutely be caught by their own bomb
        const catcher = alive
          .map((p) => ({ p, d: Math.hypot(p.pos.x - b.to.x, p.pos.y - b.to.y) }))
          .filter(({ d }) => d < BOMB.STICK_RADIUS)
          .sort((a, z) => a.d - z.d)[0]?.p;
        if (catcher) {
          w.bomb = {
            s: 'carried', slot: catcher.slot, fuseMs: b.fuseMs, fuseTotal: b.fuseTotal,
            prevSlot: b.fromSlot, noTagBackMs: BOMB.NO_TAGBACK_MS,
          };
          events.push({ kind: 'stick', slot: catcher.slot });
        } else {
          w.bomb = { s: 'ground', pos: { ...b.to }, fuseMs: b.fuseMs, fuseTotal: b.fuseTotal };
        }
      }
      break;
    }
    case 'ground': {
      b.fuseMs -= dtMs;
      if (b.fuseMs <= 0) {
        explode(w, { ...b.pos }, events);
        break;
      }
      // live grenade: first penguin to touch it owns it — thrower included
      const toucher = alive
        .map((p) => ({ p, d: Math.hypot(p.pos.x - b.pos.x, p.pos.y - b.pos.y) }))
        .filter(({ d }) => d < TUNE.PENGUIN_RADIUS + 16)
        .sort((a, z) => a.d - z.d)[0]?.p;
      if (toucher) {
        w.bomb = {
          s: 'carried', slot: toucher.slot, fuseMs: b.fuseMs, fuseTotal: b.fuseTotal,
          prevSlot: -1, noTagBackMs: 0,
        };
        events.push({ kind: 'stick', slot: toucher.slot });
      }
      break;
    }
  }
  return events;
}

function explode(w: World, at: Vec2, events: WorldEvent[]): void {
  events.push({ kind: 'explode', at });
  breakChunk(w.floe, at, BOMB.BLAST_RADIUS * 0.9);
  for (const p of w.penguins) {
    if (!p.alive) continue;
    if (Math.hypot(p.pos.x - at.x, p.pos.y - at.y) <= BOMB.BLAST_RADIUS) {
      p.alive = false;
      events.push({ kind: 'launched', slot: p.slot, at: { ...p.pos } });
      events.push({ kind: 'eliminated', slot: p.slot });
    }
  }
  w.bomb = idleBomb();
}
