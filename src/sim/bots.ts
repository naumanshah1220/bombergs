// Bot driving. Priorities, highest first:
//   1. Don't drive into the water (or a ground bomb).
//   2. Carrier: hunt the nearest victim, throw when in range.
//   3. Runner: dodge an incoming throw, flee the carrier.
//   4. Otherwise wander.

import { BOMB, carrierSlot } from './bomb';
import { marginAt } from './floe';
import type { Penguin, World } from './world';

export function botInputs(w: World, p: Penguin): { steer: number; tap: boolean } {
  const edge = edgeAvoid(w, p);
  if (edge !== undefined) return { steer: edge, tap: false };

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
      // slight lead on the target's velocity makes bots feel intentional
      const aim = Math.atan2(
        best.pos.y + best.vel.y * 0.25 - p.pos.y,
        best.pos.x + best.vel.x * 0.25 - p.pos.x,
      );
      return { steer: turnToward(p.heading, aim), tap: bestD < BOMB.PASS_RADIUS * 0.8 };
    }
    return { steer: wander(w, p), tap: false };
  }

  const abilityReady = p.ability !== undefined && p.ability.cooldownMs <= 0;

  // incoming throw at me? dodge — shield/blink/dash if we have one ready
  if (w.bomb.s === 'flying') {
    const d = Math.hypot(w.bomb.to.x - p.pos.x, w.bomb.to.y - p.pos.y);
    if (d < BOMB.STICK_RADIUS * 3) {
      const away = Math.atan2(p.pos.y - w.bomb.to.y, p.pos.x - w.bomb.to.x);
      return { steer: turnToward(p.heading, away), tap: abilityReady && w.bomb.t01 > 0.35 };
    }
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

  return { steer: wander(w, p), tap: false };
}

/** Hard override when the ice ahead runs out; undefined when safe. */
function edgeAvoid(w: World, p: Penguin): number | undefined {
  const lookAhead = 110;
  const ahead = {
    x: p.pos.x + Math.cos(p.heading) * lookAhead,
    y: p.pos.y + Math.sin(p.heading) * lookAhead,
  };
  const margin = marginAt(w.floe, ahead);
  if (margin >= 50) return undefined;
  const toCenter = Math.atan2(w.floe.cy - p.pos.y, w.floe.cx - p.pos.x);
  return turnToward(p.heading, toCenter);
}

function wander(w: World, p: Penguin): number {
  return Math.sin(w.tick / 80 + p.slot * 2.3) * 0.55;
}

function turnToward(heading: number, target: number): number {
  let diff = target - heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.max(-1, Math.min(1, diff * 2.2));
}
