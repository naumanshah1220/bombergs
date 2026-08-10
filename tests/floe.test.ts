import { describe, expect, it } from 'vitest';
import { FLOE_MIN_AREA_FRAC } from '../src/sim/constants';
import { area, breakChunk, contains, makeFloe } from '../src/sim/floe';

const rand = () => 0.5; // deterministic: every spoke = exact base radius

describe('makeFloe / contains', () => {
  it('contains the center and excludes far points', () => {
    const f = makeFloe(0, 0, 300, 0.1, rand);
    expect(contains(f, { x: 0, y: 0 })).toBe(true);
    expect(contains(f, { x: 200, y: 0 })).toBe(true);
    expect(contains(f, { x: 400, y: 0 })).toBe(false);
    expect(contains(f, { x: 0, y: -350 })).toBe(false);
  });
});

describe('breakChunk', () => {
  it('reduces area and opens water at the blast site', () => {
    const f = makeFloe(0, 0, 300, 0.1, rand);
    const before = area(f);
    const ok = breakChunk(f, { x: 250, y: 0 }, 70);
    expect(ok).toBe(true);
    expect(area(f)).toBeLessThan(before);
    expect(contains(f, { x: 250, y: 0 })).toBe(false);
  });

  it('leaves the far side intact', () => {
    const f = makeFloe(0, 0, 300, 0.1, rand);
    breakChunk(f, { x: 250, y: 0 }, 70);
    expect(contains(f, { x: -250, y: 0 })).toBe(true);
  });

  it('never shrinks below the minimum area fraction', () => {
    const f = makeFloe(0, 0, 300, 0.1, rand);
    // hammer it from every direction far past the guard
    for (let k = 0; k < 200; k++) {
      const angle = (k / 200) * Math.PI * 2;
      breakChunk(f, { x: Math.cos(angle) * (150 - (k % 5) * 30), y: Math.sin(angle) * (150 - (k % 5) * 30) }, 90);
    }
    expect(area(f)).toBeGreaterThanOrEqual(f.initialArea * FLOE_MIN_AREA_FRAC);
  });
});
