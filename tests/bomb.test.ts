import { describe, expect, it } from 'vitest';
import { BOMB, bombPos, tryThrow } from '../src/sim/bomb';
import { area } from '../src/sim/floe';
import { makeWorld, step, type World, type WorldEvent } from '../src/sim/world';

const rand = () => 0.5;

function world(n: number): World {
  const w = makeWorld(
    Array.from({ length: n }, (_, i) => ({ slot: i, name: `P${i}`, color: '#fff' })),
    rand,
  );
  // park everyone safely apart so physics doesn't interfere with bomb tests
  w.penguins.forEach((p, i) => {
    p.pos = { x: w.floe.cx + i * 200 - 200, y: w.floe.cy };
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
  it('explodes the carrier at fuse end and carves the floe', () => {
    const w = world(3);
    tickMs(w, BOMB.IDLE_MS + BOMB.SKUA_MS + 50);
    const before = area(w.floe);
    const carrier = w.bomb.s === 'carried' ? w.bomb.slot : -1;
    const events = tickMs(w, BOMB.FUSE_MAX_MS + 100);
    expect(events.some((e) => e.kind === 'explode')).toBe(true);
    expect(w.penguins.find((p) => p.slot === carrier)?.alive).toBe(false);
    expect(area(w.floe)).toBeLessThan(before);
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

  it('throws to a target in range; landing on them sticks', () => {
    const w = carriedWorld();
    w.penguins[1].pos = { x: w.penguins[0].pos.x + 100, y: w.penguins[0].pos.y };
    expect(tryThrow(w)).toBe(true);
    expect(w.bomb.s).toBe('flying');
    const events = tickMs(w, BOMB.THROW_MS + 40);
    expect(events.some((e) => e.kind === 'stick' && e.slot === 1)).toBe(true);
  });

  it('misses when the target moves — bomb lands on the ice', () => {
    const w = carriedWorld();
    w.penguins[1].pos = { x: w.penguins[0].pos.x + 100, y: w.penguins[0].pos.y };
    tryThrow(w);
    // dodge!
    w.penguins[1].pos = { x: w.penguins[1].pos.x + 300, y: w.penguins[1].pos.y };
    tickMs(w, BOMB.THROW_MS + 40);
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

  it('explodes in place, eliminating anyone in blast radius', () => {
    const w = world(3);
    w.bomb = { s: 'ground', pos: { x: w.penguins[1].pos.x + 500, y: w.penguins[1].pos.y }, fuseMs: 40, fuseTotal: 15000 };
    w.penguins[2].pos = { x: w.penguins[1].pos.x + 500 + BOMB.BLAST_RADIUS - 5, y: w.penguins[1].pos.y };
    const events = tickMs(w, 100);
    expect(events.some((e) => e.kind === 'explode')).toBe(true);
    expect(w.penguins[2].alive).toBe(false);
    expect(w.penguins[1].alive).toBe(true);
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
