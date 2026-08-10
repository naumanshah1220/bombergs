import { describe, expect, it } from 'vitest';
import {
  flatness, makeSteer, rollFromGravity, wrapAngle,
} from '../src/shared/steer';

const G = 9.81;

/** Gravity vector for a phone rolled `deg` degrees from upright. */
function rolled(deg: number) {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r) * G, y: Math.cos(r) * G, z: 0 };
}

describe('rollFromGravity', () => {
  it('is 0 upright and signed by direction', () => {
    expect(rollFromGravity(rolled(0))).toBeCloseTo(0);
    expect(rollFromGravity(rolled(30))).toBeCloseTo((30 * Math.PI) / 180);
    expect(rollFromGravity(rolled(-30))).toBeCloseTo((-30 * Math.PI) / 180);
  });
});

describe('makeSteer', () => {
  const steer = makeSteer(0);

  it('neutral → 0', () => {
    expect(steer(rolled(0))).toBe(0);
  });

  it('inside 2° deadzone → 0', () => {
    expect(steer(rolled(1))).toBe(0);
    expect(steer(rolled(-1.9))).toBe(0);
  });

  it('full lock at ±32°', () => {
    expect(steer(rolled(32))).toBeCloseTo(1);
    expect(steer(rolled(-32))).toBeCloseTo(-1);
    expect(steer(rolled(60))).toBeCloseTo(1); // clamped past lock
  });

  it('is monotonic and symmetric between deadzone and lock', () => {
    let prev = 0;
    for (let d = 3; d <= 32; d += 1) {
      const s = steer(rolled(d));
      expect(s).toBeGreaterThan(prev);
      expect(steer(rolled(-d))).toBeCloseTo(-s);
      prev = s;
    }
  });

  it('respects a non-zero calibration offset across the ±180° seam', () => {
    const seamSteer = makeSteer(Math.PI - 0.05); // calibrated near the seam
    // 10° past the seam should read as ~10°+3°... just: small positive delta
    const g = rolled(180 - 0.05 * (180 / Math.PI) + 10);
    expect(seamSteer(g)).toBeGreaterThan(0);
    expect(seamSteer(g)).toBeLessThan(1);
  });
});

describe('wrapAngle', () => {
  it('wraps into (-PI, PI]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });
});

describe('flatness', () => {
  it('is 1 for a flat phone and 0 upright', () => {
    expect(flatness({ x: 0, y: 0, z: -G })).toBeCloseTo(1);
    expect(flatness(rolled(20))).toBeCloseTo(0);
  });
});
