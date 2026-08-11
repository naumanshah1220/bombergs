// Authoritative world state + step(). Pure logic: no DOM, no network, no
// rendering. The host calls step() at 60Hz and forwards the returned events.

import { abilityTick, useAbility } from './abilities';
import { bombStep, carrierSlot, idleBomb, markDodge, type BombState } from './bomb';
import { botInputs } from './bots';
import { ARENA_H, ARENA_W, FLOE_SCALE_X, FLOE_WOBBLE, TUNE } from './constants';
import { contains, makeFloe, radiusAt, toFloeSpace, type Floe, type Vec2 } from './floe';
import type { AbilityId } from '../shared/protocol';

export type Penguin = {
  slot: number;
  name: string;
  color: string;
  pos: Vec2;
  heading: number;   // radians, 0 = +x
  vel: Vec2;
  steer: number;     // [-1, 1] latest input
  tap: boolean;      // consumed by abilities / the bomb machine each step
  throttle?: number; // gas-pedal scheme: 0..1; undefined = auto-drive (full)
  move?: Vec2;       // joystick scheme: direction+magnitude; overrides steer
  speedMult: number;
  alive: boolean;
  isDummy: boolean;  // bot-driven
  ability?: { id: AbilityId; cooldownMs: number };
  shieldMs: number;  // >0 = ice shield up
};

export type WorldEvent =
  | { kind: 'splash'; slot: number; at: Vec2 }
  | { kind: 'eliminated'; slot: number }
  | { kind: 'delivered'; slot: number }   // skua picked its victim
  | { kind: 'stick'; slot: number }       // bomb attached to a penguin
  | { kind: 'throw'; slot: number }
  | { kind: 'honk'; slot: number }        // tap with nothing to do
  | { kind: 'explode'; at: Vec2 }
  | { kind: 'launched'; slot: number; at: Vec2 } // blasted skyward
  | { kind: 'blink'; slot: number; from: Vec2; to: Vec2 }
  | { kind: 'dash'; slot: number }
  | { kind: 'shieldUp'; slot: number }
  | { kind: 'ricochet'; slot: number }           // shield bounced a landing bomb
  | { kind: 'bounce'; slot: number; at: Vec2 };  // soft rim bump (early stages)

/** Per-stage complexity dials — early stages are gentle, later ones cruel. */
export type StageRules = {
  bomb: boolean;      // is the bomb in play at all? (practice starts without)
  edgeDeath: boolean; // false: the rim is a soft bumper; true: water eliminates
  floeBreak: boolean; // do explosions carve the floe?
};

export const DEFAULT_RULES: StageRules = { bomb: true, edgeDeath: true, floeBreak: true };

export type World = {
  penguins: Penguin[];
  floe: Floe;
  bomb: BombState;
  rules: StageRules;
  tick: number;
};

export function makeWorld(
  players: { slot: number; name: string; color: string; isDummy?: boolean; ability?: AbilityId }[],
  rand: () => number = Math.random,
  rules: StageRules = DEFAULT_RULES,
): World {
  const floe = makeFloe(ARENA_W / 2, ARENA_H / 2, TUNE.FLOE_RADIUS, FLOE_WOBBLE, rand, FLOE_SCALE_X);
  const penguins = players.map((p, i) => {
    const angle = (i / players.length) * Math.PI * 2;
    const r = TUNE.FLOE_RADIUS * 0.55;
    return {
      slot: p.slot,
      name: p.name,
      color: p.color,
      pos: { x: floe.cx + Math.cos(angle) * r * floe.sx, y: floe.cy + Math.sin(angle) * r },
      heading: angle + Math.PI, // face inward
      vel: { x: 0, y: 0 },
      steer: 0,
      tap: false,
      speedMult: 1,
      alive: true,
      isDummy: p.isDummy ?? false,
      ability: p.ability ? { id: p.ability, cooldownMs: 0 } : undefined,
      shieldMs: 0,
    };
  });
  return { penguins, floe, bomb: idleBomb(), rules, tick: 0 };
}

export function step(w: World, dtMs: number): WorldEvent[] {
  const dt = dtMs / 1000;
  const events: WorldEvent[] = [];
  w.tick++;

  for (const p of w.penguins) {
    if (!p.alive) continue;
    if (p.isDummy) {
      const input = botInputs(w, p);
      p.steer = input.steer;
      if (input.tap) p.tap = true;
    }

    let power: number;
    const stickDriven = p.move !== undefined;
    if (p.move && Math.hypot(p.move.x, p.move.y) > 0.05) {
      // joystick: walk where you point — the heading tracks the stick fast
      // enough that a panicked full-reverse completes in about a tenth of a
      // second, and speed scales with deflection
      const mag = Math.min(Math.hypot(p.move.x, p.move.y), 1);
      const target = Math.atan2(p.move.y, p.move.x);
      let diff = target - p.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      p.heading += Math.max(-1, Math.min(1, diff * 2)) * 30 * dt;
      power = TUNE.BASE_SPEED * p.speedMult * mag;
    } else if (p.move) {
      power = 0; // stick released: stand still
    } else {
      // trolley-style (bots + legacy tilt schemes): always rolling
      p.heading += p.steer * TUNE.TURN_RATE * dt;
      power = TUNE.BASE_SPEED * p.speedMult * (p.throttle ?? 1);
    }
    const thrust = {
      x: Math.cos(p.heading) * power,
      y: Math.sin(p.heading) * power,
    };
    // stick control gets extra grip: momentum is drift-comedy for trolleys,
    // but it reads as "controls fighting me" under direct control
    const k = Math.min(TUNE.ICE_GRIP * (stickDriven ? TUNE.STICK_GRIP_MULT : 1) * dt, 1);
    p.vel.x += (thrust.x - p.vel.x) * k;
    p.vel.y += (thrust.y - p.vel.y) * k;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
  }

  // Trolley-vs-trolley: positional separation + a bump impulse along the normal.
  const alive = w.penguins.filter((p) => p.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const overlap = TUNE.PENGUIN_RADIUS * 2 - dist;
      if (overlap <= 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      a.pos.x -= nx * overlap / 2;
      a.pos.y -= ny * overlap / 2;
      b.pos.x += nx * overlap / 2;
      b.pos.y += ny * overlap / 2;
      const bump = 60;
      a.vel.x -= nx * bump;
      a.vel.y -= ny * bump;
      b.vel.x += nx * bump;
      b.vel.y += ny * bump;
    }
  }

  // Rim check — deadly water in late stages, a soft bumper before that.
  for (const p of w.penguins) {
    if (!p.alive) continue;
    if (!contains(w.floe, p.pos)) {
      if (w.rules.edgeDeath) {
        p.alive = false;
        events.push({ kind: 'splash', slot: p.slot, at: { ...p.pos } });
        events.push({ kind: 'eliminated', slot: p.slot });
      } else {
        // push back inside (floe space) and reflect the outward velocity
        const q = toFloeSpace(w.floe, p.pos);
        const dist = Math.hypot(q.x, q.y) || 0.001;
        const nx = q.x / dist;
        const ny = q.y / dist;
        const rim = radiusAt(w.floe, Math.atan2(q.y, q.x)) - 4;
        p.pos.x = w.floe.cx + nx * rim * w.floe.sx;
        p.pos.y = w.floe.cy + ny * rim;
        // ellipse surface normal in world space
        let nwx = nx / w.floe.sx;
        let nwy = ny;
        const nl = Math.hypot(nwx, nwy) || 0.001;
        nwx /= nl;
        nwy /= nl;
        const vOut = p.vel.x * nwx + p.vel.y * nwy;
        if (vOut > 0) {
          p.vel.x -= vOut * 1.5 * nwx; // reflect half of it back inward
          p.vel.y -= vOut * 1.5 * nwy;
          if (vOut > 60) events.push({ kind: 'bounce', slot: p.slot, at: { ...p.pos } });
        }
      }
    }
  }

  // Non-carrier taps fire drafted abilities; the carrier's tap belongs to
  // the bomb machine (throw). Abilities resolve before the bomb so a blink
  // can dodge a landing on the same frame it was tapped.
  abilityTick(w, dtMs);
  const carrier = carrierSlot(w.bomb);
  for (const p of w.penguins) {
    if (p.tap && p.alive && p.slot !== carrier && p.ability) {
      const used = useAbility(w, p);
      if (used.length) {
        events.push(...used);
        p.tap = false;
        markDodge(w, p.slot); // ability while a bomb homes on you = the dodge
      }
    }
  }

  // The bomb machine consumes taps and may eliminate penguins.
  if (w.rules.bomb) events.push(...bombStep(w, dtMs));
  for (const p of w.penguins) p.tap = false;

  return events;
}
