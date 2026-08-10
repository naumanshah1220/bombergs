// Drafted abilities, one per penguin per stage, cooldown-gated.
// The carrier can't use abilities (their tap is the throw) — drafting is
// about escape and denial, mirroring Dota PTB's blink mind-games.

import { carrierSlot } from './bomb';
import { contains } from './floe';
import type { AbilityId } from '../shared/protocol';
import type { Penguin, World, WorldEvent } from './world';

export const ABILITY_COOLDOWN_MS: Record<AbilityId, number> = {
  blink: 8000,
  dash: 4000,
  shield: 10000,
};

export const SHIELD_MS = 2000;
export const BLINK_RANGE = 220;
export const DASH_BOOST = 460;

export function useAbility(w: World, p: Penguin, rand: () => number = Math.random): WorldEvent[] {
  if (!p.alive || !p.ability || p.ability.cooldownMs > 0) return [];
  if (carrierSlot(w.bomb) === p.slot) return []; // carrier tap = throw, never ability

  const events: WorldEvent[] = [];
  switch (p.ability.id) {
    case 'blink': {
      // random landing — an escape AND a gamble (per the spec, never water)
      const from = { ...p.pos };
      for (let i = 0; i < 24; i++) {
        const a = rand() * Math.PI * 2;
        const d = 90 + rand() * (BLINK_RANGE - 90);
        const to = { x: p.pos.x + Math.cos(a) * d, y: p.pos.y + Math.sin(a) * d };
        if (contains(w.floe, to)) {
          p.pos = to;
          p.vel = { x: 0, y: 0 };
          events.push({ kind: 'blink', slot: p.slot, from, to: { ...to } });
          break;
        }
      }
      if (!events.length) return []; // fully cornered: no valid spot, no cooldown
      break;
    }
    case 'dash': {
      p.vel.x += Math.cos(p.heading) * DASH_BOOST;
      p.vel.y += Math.sin(p.heading) * DASH_BOOST;
      events.push({ kind: 'dash', slot: p.slot });
      break;
    }
    case 'shield': {
      p.shieldMs = SHIELD_MS;
      events.push({ kind: 'shieldUp', slot: p.slot });
      break;
    }
  }
  p.ability.cooldownMs = ABILITY_COOLDOWN_MS[p.ability.id];
  return events;
}

/** Per-step bookkeeping: cooldowns tick down, shields expire. */
export function abilityTick(w: World, dtMs: number): void {
  for (const p of w.penguins) {
    if (p.ability) p.ability.cooldownMs = Math.max(0, p.ability.cooldownMs - dtMs);
    p.shieldMs = Math.max(0, p.shieldMs - dtMs);
  }
}
