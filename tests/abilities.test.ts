import { describe, expect, it } from 'vitest';
import { ABILITY_COOLDOWN_MS, SHIELD_MS, useAbility } from '../src/sim/abilities';
import { BOMB } from '../src/sim/bomb';
import { cellAt } from '../src/sim/island';
import { makeWorld, step, type World } from '../src/sim/world';

import { ARENA_H, ARENA_W } from '../src/sim/constants';
const CX = ARENA_W / 2;
const CY = ARENA_H / 2;
const rand = () => 0.5;

function world(n: number, ability?: 'blink' | 'dash' | 'shield'): World {
  const w = makeWorld(
    Array.from({ length: n }, (_, i) => ({ slot: i, name: `P${i}`, color: '#fff', ability })),
    rand,
  );
  w.island.cells.fill(1);
  w.island.version++;
  w.penguins.forEach((p, i) => {
    p.pos = { x: CX + i * 200 - 200, y: CY };
    p.vel = { x: 0, y: 0 };
  });
  return w;
}

describe('blink', () => {
  it('teleports somewhere on the floe and starts its cooldown', () => {
    const w = world(2, 'blink');
    const p = w.penguins[0];
    const before = { ...p.pos };
    const events = useAbility(w, p, Math.random);
    expect(events.some((e) => e.kind === 'blink')).toBe(true);
    expect(p.pos).not.toEqual(before);
    expect(cellAt(w.island, p.pos.x, p.pos.y)).toBe(1);
    expect(p.ability!.cooldownMs).toBe(ABILITY_COOLDOWN_MS.blink);
  });

  it('cooldown gates reuse', () => {
    const w = world(2, 'blink');
    const p = w.penguins[0];
    useAbility(w, p, Math.random);
    expect(useAbility(w, p, Math.random)).toHaveLength(0);
  });
});

describe('dash', () => {
  it('adds a burst of velocity along heading', () => {
    const w = world(2, 'dash');
    const p = w.penguins[0];
    p.heading = 0;
    useAbility(w, p);
    expect(p.vel.x).toBeGreaterThan(300);
  });
});

describe('shield', () => {
  it('raises for SHIELD_MS and ricochets a landing bomb to the next penguin', () => {
    const w = world(3, 'shield');
    const [a, b] = w.penguins;
    useAbility(w, b);
    expect(b.shieldMs).toBe(SHIELD_MS);
    // bomb flies at the shielded penguin and "lands"
    w.bomb = {
      s: 'flying', fromSlot: a.slot, toSlot: b.slot, from: { ...a.pos }, to: { ...b.pos },
      t01: 0.99, dodged: false, fuseMs: 9000, fuseTotal: 15000,
    };
    const events = step(w, 32);
    expect(events.some((e) => e.kind === 'ricochet' && e.slot === b.slot)).toBe(true);
    expect(w.bomb.s).toBe('flying'); // bounced onward, not stuck
  });

  it('blocks contact passing while up', () => {
    const w = world(2, 'shield');
    const [a, b] = w.penguins;
    w.bomb = { s: 'carried', slot: a.slot, fuseMs: 9000, fuseTotal: 15000, prevSlot: -1, noTagBackMs: 0 };
    useAbility(w, b);
    b.pos = { x: a.pos.x + 10, y: a.pos.y };
    const events = step(w, 16);
    expect(events.some((e) => e.kind === 'stick')).toBe(false);
    expect(w.bomb.s === 'carried' && w.bomb.slot === a.slot).toBe(true);
  });
});

describe('carrier restriction', () => {
  it('the carrier cannot use an ability — their tap is the throw', () => {
    const w = world(2, 'dash');
    const p = w.penguins[0];
    w.bomb = { s: 'carried', slot: p.slot, fuseMs: 9000, fuseTotal: 15000, prevSlot: -1, noTagBackMs: 0 };
    expect(useAbility(w, p)).toHaveLength(0);
  });
});

describe('tap routing in step()', () => {
  it('a non-carrier tap fires the ability', () => {
    const w = world(3, 'dash');
    const p = w.penguins[2];
    w.bomb = { s: 'carried', slot: 0, fuseMs: 9000, fuseTotal: 15000, prevSlot: -1, noTagBackMs: 0 };
    p.heading = 0;
    p.tap = true;
    // keep them out of contact range so the pass logic stays quiet
    p.pos = { x: CX + 300, y: CY + 300 };
    const events = step(w, 16);
    expect(events.some((e) => e.kind === 'dash' && e.slot === p.slot)).toBe(true);
  });
});

describe('BOMB constants sanity', () => {
  it('fuse range brackets the Dota-normal 15s', () => {
    expect(BOMB.FUSE_MIN_MS).toBeLessThanOrEqual(15000);
    expect(BOMB.FUSE_MAX_MS).toBeGreaterThanOrEqual(15000);
  });
});
