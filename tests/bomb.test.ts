import { describe, expect, it } from 'vitest';
import { BOMB, bombPos, markDodge, tryThrow } from '../src/sim/bomb';
import { cellAt } from '../src/sim/island';
import { makeWorld, step, type World, type WorldEvent } from '../src/sim/world';

import { ARENA_H, ARENA_W } from '../src/sim/constants';
const CX = ARENA_W / 2;
const CY = ARENA_H / 2;
const rand = () => 0.5;

function world(n: number): World {
  const w = makeWorld(
    Array.from({ length: n }, (_, i) => ({ slot: i, name: `P${i}`, color: '#fff' })),
    rand,
  );
  // flatten to open ground so terrain never interferes with bomb tests
  w.island.cells.fill(1);
  w.island.version++;
  w.penguins.forEach((p, i) => {
    p.pos = { x: CX + i * 200 - 200, y: CY };
    p.heading = Math.PI / 2;
    p.vel = { x: 0, y: 0 };
    p.steer = 0;
  });
  return w;
}

/** Advance the sim, keeping penguins parked (steer 0, no drift). */
function tickMs(w: World, ms: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  let left = ms;
  while (left > 0) {
    const dt = Math.min(left, 16);
    for (const p of w.penguins) p.vel = { x: 0, y: 0 };
    events.push(...step(w, dt));
    left -= dt;
  }
  return events;
}

describe('delivery', () => {
  it('skua delivers to a random penguin after the idle breather', () => {
    const w = world(3);
    const events = tickMs(w, BOMB.IDLE_MS + BOMB.SKUA_MS + 50);
    expect(events.some((e) => e.kind === 'delivered')).toBe(true);
    expect(w.bomb.s).toBe('carried');
  });
});

describe('fuse', () => {
  it('explodes: carrier loses a life, gets launched, hole punched', () => {
    const w = world(3);
    tickMs(w, BOMB.IDLE_MS + BOMB.SKUA_MS + 50);
    const carrier = w.bomb.s === 'carried' ? w.bomb.slot : -1;
    const events = tickMs(w, BOMB.FUSE_MAX_MS + 100);
    const boom = events.find((e) => e.kind === 'explode');
    expect(boom).toBeDefined();
    const victim = w.penguins.find((p) => p.slot === carrier)!;
    expect(victim.alive).toBe(true); // lives system: hurt, not out
    expect(victim.lives).toBeLessThan(3);
    expect(events.some((e) => e.kind === 'launched' && e.slot === carrier)).toBe(true);
    if (boom && 'at' in boom) expect(cellAt(w.island, boom.at.x, boom.at.y)).toBe(0); // open water now
  });
});

describe('throwing', () => {
  function carriedWorld(): World {
    const w = world(3);
    tickMs(w, BOMB.IDLE_MS + BOMB.SKUA_MS + 50);
    // move bomb to slot 0 deterministically
    if (w.bomb.s === 'carried') w.bomb.slot = 0;
    return w;
  }

  it('homing: sticks to the target even when they run', () => {
    const w = carriedWorld();
    w.penguins[1].pos = { x: w.penguins[0].pos.x + 100, y: w.penguins[0].pos.y };
    expect(tryThrow(w)).toBe(true);
    expect(w.bomb.s).toBe('flying');
    // target sprints away mid-flight — doesn't matter, it homes
    w.penguins[1].pos = { x: w.penguins[1].pos.x + 400, y: w.penguins[1].pos.y };
    const events = tickMs(w, BOMB.THROW_MS + 40);
    expect(events.some((e) => e.kind === 'stick' && e.slot === 1)).toBe(true);
  });

  it('an ability fired mid-flight is the ONLY dodge — bomb thuds down', () => {
    const w = carriedWorld();
    w.penguins[1].pos = { x: w.penguins[0].pos.x + 100, y: w.penguins[0].pos.y };
    tryThrow(w);
    tickMs(w, 100);
    expect(markDodge(w, 1)).toBe(true); // what useAbility triggers in step()
    w.penguins[1].pos = { x: w.penguins[1].pos.x + 400, y: w.penguins[1].pos.y };
    tickMs(w, BOMB.THROW_MS);
    expect(w.bomb.s).toBe('ground');
  });

  it('refuses with nobody in range', () => {
    const w = carriedWorld();
    for (const p of w.penguins) if (p.slot !== 0) p.pos.x += 2000;
    expect(tryThrow(w)).toBe(false);
    expect(w.bomb.s).toBe('carried');
  });
});

describe('ground bomb', () => {
  it('sticks to the first penguin that touches it', () => {
    const w = world(2);
    w.bomb = { s: 'ground', pos: { x: w.penguins[0].pos.x + 10, y: w.penguins[0].pos.y }, fuseMs: 5000, fuseTotal: 15000 };
    const events = tickMs(w, 32);
    expect(events.some((e) => e.kind === 'stick' && e.slot === 0)).toBe(true);
    expect(w.bomb.s).toBe('carried');
  });

  it('explodes in place, costing a life to anyone in blast radius', () => {
    const w = world(3);
    w.bomb = { s: 'ground', pos: { x: w.penguins[1].pos.x + 500, y: w.penguins[1].pos.y }, fuseMs: 40, fuseTotal: 15000 };
    w.penguins[2].pos = { x: w.penguins[1].pos.x + 500 + BOMB.BLAST_RADIUS - 5, y: w.penguins[1].pos.y };
    const events = tickMs(w, 100);
    expect(events.some((e) => e.kind === 'explode')).toBe(true);
    expect(w.penguins[2].lives).toBe(2);
    expect(w.penguins[1].lives).toBe(3); // out of radius, untouched
  });
});

describe('contact pass', () => {
  it('ramming a penguin transfers the bomb, no-tag-back protected', () => {
    const w = world(3);
    tickMs(w, BOMB.IDLE_MS + BOMB.SKUA_MS + 50);
    if (w.bomb.s !== 'carried') throw new Error('expected carried');
    w.bomb.slot = 0;
    // slot 1 rams the carrier
    w.penguins[1].pos = { x: w.penguins[0].pos.x + 20, y: w.penguins[0].pos.y };
    const events = tickMs(w, 32);
    expect(events.some((e) => e.kind === 'stick' && e.slot === 1)).toBe(true);
    if (w.bomb.s !== 'carried') throw new Error('expected carried');
    expect(w.bomb.slot).toBe(1);
    expect(w.bomb.prevSlot).toBe(0);
    // still overlapping, but no instant tag-back
    const more = tickMs(w, 32);
    expect(more.some((e) => e.kind === 'stick' && e.slot === 0)).toBe(false);
  });

  it('carrier is faster', () => {
    const w = world(2);
    tickMs(w, BOMB.IDLE_MS + BOMB.SKUA_MS + 50);
    if (w.bomb.s !== 'carried') throw new Error('expected carried');
    const carrier = w.penguins.find((p) => p.slot === (w.bomb as { slot: number }).slot)!;
    expect(carrier.speedMult).toBeGreaterThan(1);
  });
});

describe('bombPos', () => {
  it('tracks the carrier', () => {
    const w = world(2);
    tickMs(w, BOMB.IDLE_MS + BOMB.SKUA_MS + 50);
    if (w.bomb.s !== 'carried') throw new Error('expected carried');
    const carrier = w.penguins.find((p) => p.slot === (w.bomb as { slot: number }).slot)!;
    expect(bombPos(w)).toEqual(carrier.pos);
  });
});
