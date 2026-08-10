// The ice floe as a star-shaped polygon: a center plus one radius per evenly
// spaced spoke angle. Star shape keeps every operation trivial (containment,
// area, carving) while explosions still leave organic-looking bites — and it
// can never self-intersect, no matter how much gets blown off.

import { FLOE_MIN_AREA_FRAC, FLOE_SPOKES } from './constants';

export type Vec2 = { x: number; y: number };

export type Floe = {
  cx: number;
  cy: number;
  radii: number[];        // length FLOE_SPOKES, radius per spoke angle
  initialArea: number;
};

export const spokeAngle = (i: number): number => (i / FLOE_SPOKES) * Math.PI * 2;

export function makeFloe(cx: number, cy: number, radius: number, wobble: number, rand: () => number = Math.random): Floe {
  const radii: number[] = [];
  for (let i = 0; i < FLOE_SPOKES; i++) {
    radii.push(radius * (1 - wobble / 2 + rand() * wobble));
  }
  const floe: Floe = { cx, cy, radii, initialArea: 0 };
  floe.initialArea = area(floe);
  return floe;
}

export function area(f: Floe): number {
  let a = 0;
  const dTheta = (Math.PI * 2) / FLOE_SPOKES;
  for (let i = 0; i < FLOE_SPOKES; i++) {
    a += 0.5 * f.radii[i] * f.radii[(i + 1) % FLOE_SPOKES] * Math.sin(dTheta);
  }
  return a;
}

/** Interpolated boundary radius at an arbitrary angle. */
export function radiusAt(f: Floe, angle: number): number {
  const t = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / ((Math.PI * 2) / FLOE_SPOKES);
  const i = Math.floor(t) % FLOE_SPOKES;
  const frac = t - Math.floor(t);
  return f.radii[i] * (1 - frac) + f.radii[(i + 1) % FLOE_SPOKES] * frac;
}

export function contains(f: Floe, p: Vec2): boolean {
  const dx = p.x - f.cx;
  const dy = p.y - f.cy;
  const dist = Math.hypot(dx, dy);
  return dist <= radiusAt(f, Math.atan2(dy, dx));
}

/**
 * Carve a blast of radius r centered at `at` out of the floe. Each spoke ray
 * that passes through the blast circle is shortened to its entry point, so a
 * mid-floe blast opens a wedge to the water — ice "cracking open". Refuses to
 * shrink below FLOE_MIN_AREA_FRAC of the initial area (final-duel slab).
 */
export function breakChunk(f: Floe, at: Vec2, r: number): boolean {
  const bx = at.x - f.cx;
  const by = at.y - f.cy;
  const bDist = Math.hypot(bx, by);
  const bAngle = Math.atan2(by, bx);
  const next = [...f.radii];
  for (let i = 0; i < FLOE_SPOKES; i++) {
    let phi = spokeAngle(i) - bAngle;
    phi = Math.atan2(Math.sin(phi), Math.cos(phi)); // wrap to [-PI, PI]
    const perp = Math.abs(bDist * Math.sin(phi));
    if (perp >= r || Math.abs(phi) > Math.PI / 2) continue;
    const entry = bDist * Math.cos(phi) - Math.sqrt(r * r - perp * perp);
    if (entry < next[i]) next[i] = Math.max(entry, 0);
  }
  const candidate: Floe = { ...f, radii: next };
  if (area(candidate) < f.initialArea * FLOE_MIN_AREA_FRAC) return false;
  f.radii = next;
  return true;
}
