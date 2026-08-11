// Authoritative world state + step(). Pure logic: no DOM, no network, no
// rendering. The host calls step() at 60Hz and forwards the returned events.

import { ABILITY_POOL, abilityTick, useAbility } from './abilities';
import { bombStep, carrierSlot, idleBomb, markDodge, type BombState } from './bomb';
import { botInputs } from './bots';
import {
  GRID_COLS, GRID_ROWS, INVULN_MS, MAX_LIVES,
  MAX_PICKUPS, PICKUP_INTERVAL_MS, PICKUP_RADIUS, START_LIVES, TUNE,
} from './constants';
import {
  cellAt, cellCenter, generateIsland, groundCells, isGround,
  type Island, type Vec2,
} from './island';
import type { AbilityId } from '../shared/protocol';

export type { Vec2 };

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
  lives: number;
  invulnMs: number;  // post-hit mercy: no blast damage, flashing
  isDummy: boolean;  // bot-driven
  ability?: { id: AbilityId; cooldownMs: number };
  shieldMs: number;  // >0 = ice shield up
};

/** Match dials. */
export type StageRules = {
  bomb: boolean;      // is the bomb in play at all? (practice starts without)
  edgeDeath: boolean; // false: water is a wall (practice); true: water costs a life
  floeBreak: boolean; // do explosions destroy tiles?
  lives: number;      // starting lives (practice uses a huge number)
};

export const DEFAULT_RULES: StageRules = { bomb: true, edgeDeath: true, floeBreak: true, lives: START_LIVES };

export type Pickup = {
  id: number;
  kind: 'heart' | 'crate';
  pos: Vec2;
  bornTick: number;
};

export type WorldEvent =
  | { kind: 'splash'; slot: number; at: Vec2 }
  | { kind: 'eliminated'; slot: number }
  | { kind: 'delivered'; slot: number }   // the sky picked its victim
  | { kind: 'stick'; slot: number }       // bomb attached to someone
  | { kind: 'throw'; slot: number }
  | { kind: 'honk'; slot: number }        // tap with nothing to do
  | { kind: 'explode'; at: Vec2 }
  | { kind: 'launched'; slot: number; at: Vec2 } // blasted skyward
  | { kind: 'blink'; slot: number; from: Vec2; to: Vec2 }
  | { kind: 'dash'; slot: number }
  | { kind: 'shieldUp'; slot: number }
  | { kind: 'ricochet'; slot: number }           // shield bounced a landing bomb
  | { kind: 'bounce'; slot: number; at: Vec2 }   // (legacy, unused)
  | { kind: 'lifeLost'; slot: number; lives: number; at: Vec2 }
  | { kind: 'pickup'; slot: number; pkind: 'heart' | 'crate'; ability?: AbilityId };

export type World = {
  penguins: Penguin[];
  island: Island;
  bomb: BombState;
  rules: StageRules;
  pickups: Pickup[];
  pickupTimerMs: number;
  nextPickupId: number;
  tick: number;
};

export function makeWorld(
  players: { slot: number; name: string; color: string; isDummy?: boolean; ability?: AbilityId }[],
  rand: () => number = Math.random,
  rules: StageRules = DEFAULT_RULES,
): World {
  const island = generateIsland(GRID_COLS, GRID_ROWS, rand);
  // spawn spread: ground cells sorted by angle around the center, sampled evenly
  const cx = (GRID_COLS * 64) / 2;
  const cy = (GRID_ROWS * 64) / 2;
  const ring = groundCells(island)
    .map(({ c, r }) => cellCenter(island, c, r))
    .filter((p) => Math.hypot(p.x - cx, p.y - cy) > 150)
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const penguins = players.map((p, i) => {
    const spot = ring.length
      ? ring[Math.floor((i / players.length) * ring.length)]
      : { x: cx, y: cy };
    return {
      slot: p.slot,
      name: p.name,
      color: p.color,
      pos: { ...spot },
      heading: Math.atan2(cy - spot.y, cx - spot.x),
      vel: { x: 0, y: 0 },
      steer: 0,
      tap: false,
      speedMult: 1,
      alive: true,
      lives: rules.lives,
      invulnMs: 0,
      isDummy: p.isDummy ?? false,
      ability: p.ability ? { id: p.ability, cooldownMs: 0 } : undefined,
      shieldMs: 0,
    };
  });
  return {
    penguins, island, bomb: idleBomb(), rules,
    pickups: [], pickupTimerMs: PICKUP_INTERVAL_MS / 2, nextPickupId: 1,
    tick: 0,
  };
}

/** A hit that costs a life; returns the resulting events. */
export function loseLife(w: World, p: Penguin, at: Vec2): WorldEvent[] {
  p.lives--;
  const events: WorldEvent[] = [{ kind: 'lifeLost', slot: p.slot, lives: p.lives, at: { ...at } }];
  if (p.lives <= 0) {
    p.alive = false;
    events.push({ kind: 'eliminated', slot: p.slot });
  } else {
    p.invulnMs = INVULN_MS;
  }
  return events;
}

/** A random safe ground cell to reappear on. */
export function respawnPoint(w: World, rand: () => number = Math.random): Vec2 {
  const cells = groundCells(w.island);
  if (!cells.length) return { x: (GRID_COLS * 64) / 2, y: (GRID_ROWS * 64) / 2 };
  const pick = cells[Math.floor(rand() * cells.length)];
  return cellCenter(w.island, pick.c, pick.r);
}

/** Cells you cannot MOVE into: ledges always; water too when it's a wall. */
function blockedAt(w: World, x: number, y: number): boolean {
  const cell = cellAt(w.island, x, y);
  if (cell === 2) return true;
  if (cell === 0 && !w.rules.edgeDeath) return true;
  return false;
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
      p.throttle = input.throttle;
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
      // bots + legacy tilt schemes: always rolling
      p.heading += p.steer * TUNE.TURN_RATE * dt;
      power = TUNE.BASE_SPEED * p.speedMult * (p.throttle ?? 1);
    }
    const thrust = {
      x: Math.cos(p.heading) * power,
      y: Math.sin(p.heading) * power,
    };
    const k = Math.min(TUNE.ICE_GRIP * (stickDriven ? TUNE.STICK_GRIP_MULT : 1) * dt, 1);
    p.vel.x += (thrust.x - p.vel.x) * k;
    p.vel.y += (thrust.y - p.vel.y) * k;

    // axis-separated slide against ledges (and water-walls in practice)
    const nx = p.pos.x + p.vel.x * dt;
    if (blockedAt(w, nx, p.pos.y)) p.vel.x = 0;
    else p.pos.x = nx;
    const ny = p.pos.y + p.vel.y * dt;
    if (blockedAt(w, p.pos.x, ny)) p.vel.y = 0;
    else p.pos.y = ny;
  }

  // gentle bump between players
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
      const nx2 = dx / dist;
      const ny2 = dy / dist;
      a.pos.x -= nx2 * overlap / 2;
      a.pos.y -= ny2 * overlap / 2;
      b.pos.x += nx2 * overlap / 2;
      b.pos.y += ny2 * overlap / 2;
      const bump = 45;
      a.vel.x -= nx2 * bump;
      a.vel.y -= ny2 * bump;
      b.vel.x += nx2 * bump;
      b.vel.y += ny2 * bump;
    }
  }

  // Water check — falling in costs a life.
  for (const p of w.penguins) {
    if (!p.alive) continue;
    if (w.rules.edgeDeath && cellAt(w.island, p.pos.x, p.pos.y) === 0) {
      events.push({ kind: 'splash', slot: p.slot, at: { ...p.pos } });
      events.push(...loseLife(w, p, p.pos));
      if (p.alive) {
        p.pos = respawnPoint(w);
        p.vel = { x: 0, y: 0 };
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

  // The bomb machine consumes taps and may cost lives.
  if (w.rules.bomb) events.push(...bombStep(w, dtMs));
  for (const p of w.penguins) p.tap = false;

  // invulnerability windows tick down
  for (const p of w.penguins) p.invulnMs = Math.max(0, p.invulnMs - dtMs);

  // Pickups: spawn on a timer while under the cap, collect on touch.
  if (w.rules.bomb) {
    w.pickupTimerMs -= dtMs;
    if (w.pickupTimerMs <= 0 && w.pickups.length < MAX_PICKUPS) {
      w.pickupTimerMs = PICKUP_INTERVAL_MS;
      w.pickups.push({
        id: w.nextPickupId++,
        kind: Math.random() < 0.3 ? 'heart' : 'crate',
        pos: respawnPoint(w, Math.random),
        bornTick: w.tick,
      });
    }
    for (const pk of [...w.pickups]) {
      const taker = w.penguins.find((p) =>
        p.alive && Math.hypot(p.pos.x - pk.pos.x, p.pos.y - pk.pos.y) < TUNE.PENGUIN_RADIUS + PICKUP_RADIUS);
      if (!taker) continue;
      w.pickups = w.pickups.filter((q) => q.id !== pk.id);
      if (pk.kind === 'heart') {
        taker.lives = Math.min(taker.lives + 1, MAX_LIVES);
        events.push({ kind: 'pickup', slot: taker.slot, pkind: 'heart' });
      } else {
        const id = ABILITY_POOL[Math.floor(Math.random() * ABILITY_POOL.length)];
        taker.ability = { id, cooldownMs: 0 };
        events.push({ kind: 'pickup', slot: taker.slot, pkind: 'crate', ability: id });
      }
    }
  }

  return events;
}

export { isGround };
