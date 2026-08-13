// Bot driving, in two layers:
//   1. INTENT — where this bot wants to go: hunt, dodge, flee, shop, wander,
//      or go find the stairs when it is stranded on its own level.
//   2. SAFETY — bends that intent around water and cliffs.
// Keeping them separate matters: safety used to be a hard override that ran
// first, so a carrier standing anywhere near a shoreline stopped hunting
// entirely and matches stalled out with survivors still standing.

import { BOMB, carrierSlot, fuseFrac } from './bomb';
import { ARENA_H, ARENA_W, TUNE } from './constants';
import { canStep, cellAt, isGround, isStairAt, nearestStair } from './island';
import type { Penguin, World } from './world';

/** Where the bot wants to go this tick, before safety has its say. */
function intent(w: World, p: Penguin): { ang: number; tap: boolean } {
  const angTo = (t: { x: number; y: number }): number => Math.atan2(t.y - p.pos.y, t.x - p.pos.x);
  const carrier = carrierSlot(w.bomb);

  if (carrier === p.slot) {
    // hunt: nearest living non-exempt target
    const b = w.bomb;
    const exclude = b.s === 'carried' && b.noTagBackMs > 0 ? b.prevSlot : undefined;
    let best: Penguin | undefined;
    let bestD = Infinity;
    for (const q of w.penguins) {
      if (!q.alive || q.slot === p.slot || q.slot === exclude) continue;
      const d = Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (best) {
      const via = navPoint(w, p, best.pos);
      const ang = via
        ? angTo(via)
        : angTo({ x: best.pos.x + best.vel.x * 0.25, y: best.pos.y + best.vel.y * 0.25 });
      return { ang, tap: bestD < TUNE.THROW_RADIUS * 0.8 };
    }
    return { ang: p.heading + wander(w, p), tap: false };
  }

  const abilityReady = p.ability !== undefined && p.ability.cooldownMs <= 0;

  // bomb homing on ME? the only escape is an ability at the right moment
  if (w.bomb.s === 'flying' && w.bomb.toSlot === p.slot && !w.bomb.dodged) {
    return {
      ang: Math.atan2(p.pos.y - w.bomb.from.y, p.pos.x - w.bomb.from.x),
      tap: abilityReady && w.bomb.t01 > 0.4,
    };
  }

  // A dropped bomb with plenty of fuse left is an OPPORTUNITY, not a hazard:
  // grab it and tag someone. Bots that fled every ground bomb left it lying
  // there to burn out harmlessly — a third of each match with the bomb out of
  // play, and nobody losing lives.
  if (w.bomb.s === 'ground') {
    const d = Math.hypot(w.bomb.pos.x - p.pos.x, w.bomb.pos.y - p.pos.y);
    const hot = fuseFrac(w.bomb) > 0.5; // past halfway: too risky to pick up
    if (hot && d < BOMB.BLAST_RADIUS * 1.4) {
      return { ang: Math.atan2(p.pos.y - w.bomb.pos.y, p.pos.x - w.bomb.pos.x), tap: false };
    }
    if (!hot && d < 420) return { ang: angTo(navPoint(w, p, w.bomb.pos) ?? w.bomb.pos), tap: false };
  }

  // flee a nearby carrier — panic-button an escape ability when cornered
  if (carrier !== undefined) {
    const hunter = w.penguins.find((q) => q.slot === carrier);
    if (hunter?.alive) {
      const d = Math.hypot(hunter.pos.x - p.pos.x, hunter.pos.y - p.pos.y);
      if (d < 320) {
        const cornered = d < 160 && p.ability !== undefined;
        return {
          ang: Math.atan2(p.pos.y - hunter.pos.y, p.pos.x - hunter.pos.x),
          tap: abilityReady && cornered,
        };
      }
    }
  }

  // Free time: shopping trip to the nearest pickup that is actually worth
  // something. Bots used to fetch every heart on the map, and once they
  // stopped drowning they out-healed the bomb and matches never ended.
  let bestPk: { x: number; y: number } | undefined;
  let bestD = 520;
  for (const pk of w.pickups) {
    // "Wounded" is relative to THIS match's starting lives, not the global
    // default — practice and short matches set their own.
    const worth = pk.kind === 'heart' ? p.lives < w.rules.lives : p.ability === undefined;
    if (!worth) continue;
    const d = Math.hypot(pk.pos.x - p.pos.x, pk.pos.y - p.pos.y);
    if (d < bestD) { bestD = d; bestPk = pk.pos; }
  }
  if (bestPk) return { ang: angTo(navPoint(w, p, bestPk) ?? bestPk), tap: false };

  // Stranded on a level with nobody else on it? The bomb can't change hands
  // across a cliff, so the match stalls — go find the stairs and rejoin.
  const myLevel = cellAt(w.island, p.pos.x, p.pos.y);
  if (myLevel >= 1 && !isStairAt(w.island, p.pos.x, p.pos.y)) {
    const alone = !w.penguins.some((q) =>
      q.alive && q.slot !== p.slot && cellAt(w.island, q.pos.x, q.pos.y) === myLevel);
    if (alone) {
      const stair = nearestStair(w.island, p.pos);
      if (stair) return { ang: angTo(stair), tap: false };
    }
  }
  return { ang: p.heading + wander(w, p), tap: false };
}

export function botInputs(w: World, p: Penguin): { steer: number; tap: boolean; throttle?: number } {
  const want = intent(w, p);
  const safe = safeSteer(w, p, want.ang);
  // Safety shapes movement only. Gating taps on it once looked tidy and
  // quietly stopped carriers ever throwing near a shoreline.
  return { steer: safe.steer, tap: want.tap, throttle: safe.throttle };
}

/**
 * Where to head when the target may be on a different level: straight at it
 * when levels match or we're already on a staircase; otherwise via stairs.
 */
function navPoint(w: World, p: Penguin, target: { x: number; y: number }): { x: number; y: number } | undefined {
  const myCell = cellAt(w.island, p.pos.x, p.pos.y);
  const targetCell = cellAt(w.island, target.x, target.y);
  if (myCell === targetCell || isStairAt(w.island, p.pos.x, p.pos.y)) return undefined;
  return nearestStair(w.island, p.pos);
}

// px between ray samples. This has to be small relative to a 64px tile AND
// start close to the body: a bot standing 56px into its tile used to have its
// first sample land 16px away — already in the NEXT tile — so the water cell
// it was about to enter half a pixel later was never seen. That single blind
// spot was most of the falls.
const PROBE_STEP = 8;

/** How far the bot can travel along `ang` before hitting water or a cliff. */
function clearRun(w: World, p: Penguin, ang: number, maxDist: number): number {
  for (let d = PROBE_STEP; d <= maxDist; d += PROBE_STEP) {
    const q = { x: p.pos.x + Math.cos(ang) * d, y: p.pos.y + Math.sin(ang) * d };
    if (!isGround(w.island, q) || !canStep(w.island, p.pos, q)) return d - PROBE_STEP;
  }
  return maxDist;
}

const SHORE_CLEARANCE = 46; // px of daylight a bot tries to keep from water

/**
 * Direction pointing away from nearby water, or undefined when the bot has
 * room on all sides.
 *
 * Ray casting alone is not enough: a bot walking along a shore has water
 * BESIDE it, never ahead, so every forward probe reads clear right up until
 * a stray pixel of drift drops it in. Most falls looked exactly like that.
 */
function shorePush(w: World, p: Penguin): number | undefined {
  let rx = 0;
  let ry = 0;
  let hits = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const q = { x: p.pos.x + Math.cos(a) * SHORE_CLEARANCE, y: p.pos.y + Math.sin(a) * SHORE_CLEARANCE };
    if (!isGround(w.island, q)) { rx -= Math.cos(a); ry -= Math.sin(a); hits++; }
  }
  return hits ? Math.atan2(ry, rx) : undefined;
}

/**
 * Bend `desired` around water and cliffs. `throttle` is undefined when the
 * bot is free to run at full speed — callers use that to tell "cruising" from
 * "recovering", so it must stay undefined on the safe path.
 */
function safeSteer(
  w: World, p: Penguin, desired: number,
): { steer: number; throttle?: number } {
  const speed = Math.hypot(p.vel.x, p.vel.y);
  // Momentum carries past the point where you let go, so plan around where
  // the bot can actually stop, not where it currently is.
  const stopDist = speed / Math.max(TUNE.ICE_GRIP, 0.5) + TUNE.PENGUIN_RADIUS;
  const lookAhead = Math.max(110, stopDist * 2.2);
  // Ice makes velocity lag heading, so where the FEET point and where the
  // body SLIDES are different directions — water in either one is trouble.
  const slideAng = speed > 20 ? Math.atan2(p.vel.y, p.vel.x) : p.heading;

  const wantRun = clearRun(w, p, desired, lookAhead);
  const slideRun = clearRun(w, p, slideAng, lookAhead);
  const push = shorePush(w, p);
  if (wantRun >= lookAhead && slideRun >= lookAhead && push === undefined) {
    return { steer: turnToward(p.heading, desired) };
  }

  // Sweep around the DESIRED direction, not the current heading: the bot
  // should still be going where it wanted, just along a safe line.
  let bestAng = desired;
  let bestScore = -Infinity;
  for (let k = -8; k <= 8; k++) {
    const ang = desired + (k * Math.PI) / 8;
    const run = clearRun(w, p, ang, lookAhead);
    const away = push === undefined ? 0 : Math.cos(ang - push) * 55;
    const keepGoal = Math.cos(ang - desired) * 45; // give up as little as possible
    if (run + away + keepGoal > bestScore) { bestScore = run + away + keepGoal; bestAng = ang; }
  }
  // Marooned on a shard with nowhere clear: aim at the arena centre and stop.
  if (bestScore <= 0) {
    const toCenter = Math.atan2(ARENA_H / 2 - p.pos.y, ARENA_W / 2 - p.pos.x);
    return { steer: turnToward(p.heading, toCenter), throttle: 0 };
  }
  // Committed to a slide that ends in water? Brake — steering alone won't save
  // it. Otherwise keep most of the speed so bots stay in the game.
  return { steer: turnToward(p.heading, bestAng), throttle: slideRun <= stopDist ? 0 : 0.75 };
}

function wander(w: World, p: Penguin): number {
  return Math.sin(w.tick / 80 + p.slot * 2.3) * 0.55;
}

function turnToward(heading: number, target: number): number {
  let diff = target - heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.max(-1, Math.min(1, diff * 2.2));
}
