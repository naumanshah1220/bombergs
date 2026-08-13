import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '../src/shared/protocol';
import { makeWorld, step, type WorldEvent } from '../src/sim/world';

// Full-game soak: four bots play an entire stage to completion. Catches
// stalls (bomb never cycling), NaN physics, and bots suiciding en masse.

function playStage(seed: number): { events: WorldEvent[]; ms: number; survivors: number } {
  const w = makeWorld(
    Array.from({ length: 4 }, (_, i) => ({
      slot: i, name: `B${i}`, color: PLAYER_COLORS[i], isDummy: true,
    })),
    () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff),
    { bomb: true, edgeDeath: true, floeBreak: true, lives: 2 },
  );
  const events: WorldEvent[] = [];
  let ms = 0;
  // Guards against STALLS, not slowness. Once bots learned to keep off the
  // shoreline, drowning stopped being a major attrition source and matches
  // lengthened to ~4-5 minutes, brushing the old 5-minute ceiling. Measured
  // finishes sit at 220-300s, so this leaves real headroom while still
  // failing loudly if the bomb loop ever deadlocks.
  const LIMIT = 8 * 60 * 1000;
  while (ms < LIMIT) {
    events.push(...step(w, 16));
    ms += 16;
    if (w.penguins.filter((p) => p.alive).length <= 1) break;
  }
  return { events, ms, survivors: w.penguins.filter((p) => p.alive).length };
}

describe('bot soak', () => {
  it('a 4-bot match always finishes, with bombs in the mix', () => {
    let explosions = 0;
    for (const seed of [1, 42, 777]) {
      const { events, ms, survivors } = playStage(seed);
      expect(survivors).toBeLessThanOrEqual(1);
      expect(ms).toBeLessThan(8 * 60 * 1000);
      explosions += events.filter((e) => e.kind === 'explode').length;
      expect(events.some((e) => e.kind === 'stick')).toBe(true);
      // physics stayed finite
      expect(events.every((e) => !('at' in e) || (Number.isFinite(e.at.x) && Number.isFinite(e.at.y)))).toBe(true);
    }
    // pickups use Math.random, so single seeds vary — but across three
    // matches the bomb must have gone off at least once
    expect(explosions).toBeGreaterThanOrEqual(1);
  });

  it('bombs get passed around, not just detonated on the first victim', () => {
    const { events } = playStage(1234);
    const sticks = events.filter((e) => e.kind === 'stick').length;
    expect(sticks).toBeGreaterThan(2);
  });
});
