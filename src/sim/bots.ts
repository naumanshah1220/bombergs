// Bot driving. Priorities, highest first:
//   1. Don't drive into the water (or a ground bomb).
//   2. Carrier: hunt the nearest victim, throw when in range.
//   3. Runner: dodge an incoming throw, flee the carrier.
//   4. Otherwise wander.

import { BOMB, carrierSlot } from './bomb';
import { ARENA_H, ARENA_W } from './constants';
import { canStep, cellAt, isGround, isStairAt, nearestStair } from './island';
import type { Penguin, World } from './world';

export function botInputs(w: World, p: Penguin): { steer: number; tap: boolean; throttle?: number } {
  const edge = edgeAvoid(w, p);
  if (edge !== undefined) return { steer: edge, tap: false, throttle: 0.3 }; // brake while turning away

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
      const aimPt = navPoint(w, p, best.pos);
      const aim = aimPt
        ? Math.atan2(aimPt.y - p.pos.y, aimPt.x - p.pos.x)
        : Math.atan2(
            best.pos.y + best.vel.y * 0.25 - p.pos.y,
            best.pos.x + best.vel.x * 0.25 - p.pos.x,
          );
      return { steer: turnToward(p.heading, aim), tap: bestD < BOMB.PASS_RADIUS * 0.8 };
    }
    return { steer: wander(w, p), tap: false };
  }

  const abilityReady = p.ability !== undefined && p.ability.cooldownMs <= 0;

  // bomb homing on ME? the only escape is an ability at the right moment
  if (w.bomb.s === 'flying' && w.bomb.toSlot === p.slot && !w.bomb.dodged) {
    const away = Math.atan2(p.pos.y - w.bomb.from.y, p.pos.x - w.bomb.from.x);
    return { steer: turnToward(p.heading, away), tap: abilityReady && w.bomb.t01 > 0.4 };
  }

  // ground bomb nearby? steer clear
  if (w.bomb.s === 'ground') {
    const d = Math.hypot(w.bomb.pos.x - p.pos.x, w.bomb.pos.y - p.pos.y);
    if (d < BOMB.BLAST_RADIUS * 1.4) {
      const away = Math.atan2(p.pos.y - w.bomb.pos.y, p.pos.x - w.bomb.pos.x);
      return { steer: turnToward(p.heading, away), tap: false };
    }
  }

  // flee a nearby carrier — panic-button an escape ability when cornered
  if (carrier !== undefined) {
    const hunter = w.penguins.find((q) => q.slot === carrier);
    if (hunter?.alive) {
      const d = Math.hypot(hunter.pos.x - p.pos.x, hunter.pos.y - p.pos.y);
      if (d < 320) {
        const away = Math.atan2(p.pos.y - hunter.pos.y, p.pos.x - hunter.pos.x);
        const cornered = d < 160 && (p.ability?.id === 'blink' || p.ability?.id === 'dash' || p.ability?.id === 'shield');
        return { steer: turnToward(p.heading, away), tap: abilityReady && cornered };
      }
    }
  }

  // free time: shopping trip to the nearest pickup
  let bestPk: { x: number; y: number } | undefined;
  let bestD = 520;
  for (const pk of w.pickups) {
    const d = Math.hypot(pk.pos.x - p.pos.x, pk.pos.y - p.pos.y);
    if (d < bestD) { bestD = d; bestPk = pk.pos; }
  }
  if (bestPk) {
    const aim = Math.atan2(bestPk.y - p.pos.y, bestPk.x - p.pos.x);
    return { steer: turnToward(p.heading, aim), tap: false };
  }

  // idle on a plateau? amble toward the stairs so you don't get marooned
  if (cellAt(w.island, p.pos.x, p.pos.y) === 2 && w.tick % 3 === 0) {
    const stair = nearestStair(w.island, p.pos);
    if (stair) return { steer: turnToward(p.heading, Math.atan2(stair.y - p.pos.y, stair.x - p.pos.x)), tap: false };
  }
  return { steer: wander(w, p), tap: false };
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

/** Hard override when the path ahead is water or a cliff; undefined when safe. */
function edgeAvoid(w: World, p: Penguin): number | undefined {
  const speed = Math.hypot(p.vel.x, p.vel.y);
  const lookAhead = 70 + speed * 0.45;
  const probe = (ang: number, dist: number) => ({
    x: p.pos.x + Math.cos(ang) * dist,
    y: p.pos.y + Math.sin(ang) * dist,
  });
  const aheadWater = !isGround(w.island, probe(p.heading, lookAhead))
    || !isGround(w.island, probe(p.heading, lookAhead * 0.5));
  if (aheadWater) {
    // pick the side with more ice under it
    const leftOk = isGround(w.island, probe(p.heading - 0.7, lookAhead));
    const rightOk = isGround(w.island, probe(p.heading + 0.7, lookAhead));
    if (leftOk && !rightOk) return -1;
    if (rightOk && !leftOk) return 1;
    const toCenter = Math.atan2(ARENA_H / 2 - p.pos.y, ARENA_W / 2 - p.pos.x);
    return turnToward(p.heading, toCenter);
  }
  // cliff face dead ahead? veer toward the stairs instead of grinding on it
  if (!canStep(w.island, p.pos, probe(p.heading, 40))) {
    const stair = nearestStair(w.island, p.pos);
    const goal = stair ?? { x: ARENA_W / 2, y: ARENA_H / 2 };
    return turnToward(p.heading, Math.atan2(goal.y - p.pos.y, goal.x - p.pos.x));
  }
  return undefined;
}

function wander(w: World, p: Penguin): number {
  return Math.sin(w.tick / 80 + p.slot * 2.3) * 0.55;
}

function turnToward(heading: number, target: number): number {
  let diff = target - heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.max(-1, Math.min(1, diff * 2.2));
}
