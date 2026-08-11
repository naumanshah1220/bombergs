// The ice floe as a star-shaped polygon: a center plus one radius per evenly
// spaced spoke angle, stretched horizontally by `sx` into a wide berg that
// fills a 16:9 screen. Star shape keeps every operation trivial (containment,
// area, carving) while explosions still leave organic-looking bites — and it
// can never self-intersect, no matter how much gets blown off.
//
// All radius math happens in "floe space" (x divided by sx); world-space
// callers go through toFloeSpace / boundaryPoint.

import { FLOE_MIN_AREA_FRAC, FLOE_SPOKES } from './constants';

export type Vec2 = { x: number; y: number };

export type Hole = { x: number; y: number; r: number }; // world coords

export type Floe = {
  cx: number;
  cy: number;
  sx: number;             // horizontal stretch (1 = circle)
  radii: number[];        // length FLOE_SPOKES, radius per spoke angle (floe space)
  holes: Hole[];          // blast punctures — open water inside the ice
  initialArea: number;
};

export const spokeAngle = (i: number): number => (i / FLOE_SPOKES) * Math.PI * 2;

export function makeFloe(
  cx: number, cy: number, radius: number, wobble: number,
  rand: () => number = Math.random, sx = 1,
): Floe {
  const radii: number[] = [];
  for (let i = 0; i < FLOE_SPOKES; i++) {
    radii.push(radius * (1 - wobble / 2 + rand() * wobble));
  }
  const floe: Floe = { cx, cy, sx, radii, holes: [], initialArea: 0 };
  floe.initialArea = area(floe);
  return floe;
}

/** Punch a small blast hole — open water you can fall into. */
export function addHole(f: Floe, at: Vec2, r: number): void {
  f.holes.push({ x: at.x, y: at.y, r });
}

export function inHole(f: Floe, p: Vec2): boolean {
  return f.holes.some((h) => Math.hypot(p.x - h.x, p.y - h.y) < h.r);
}

/** World point → floe space (undoes the horizontal stretch). */
export function toFloeSpace(f: Floe, p: Vec2): Vec2 {
  return { x: (p.x - f.cx) / f.sx, y: p.y - f.cy };
}

/** Boundary vertex i in world space, optionally inset toward the center. */
export function boundaryPoint(f: Floe, i: number, inset = 0): Vec2 {
  const a = spokeAngle(i);
  const r = Math.max(f.radii[i] - inset, 0);
  return { x: f.cx + Math.cos(a) * r * f.sx, y: f.cy + Math.sin(a) * r };
}

export function area(f: Floe): number {
  let a = 0;
  const dTheta = (Math.PI * 2) / FLOE_SPOKES;
  for (let i = 0; i < FLOE_SPOKES; i++) {
    a += 0.5 * f.radii[i] * f.radii[(i + 1) % FLOE_SPOKES] * Math.sin(dTheta);
  }
  return a * f.sx;
}

/** Interpolated boundary radius at a floe-space angle. */
export function radiusAt(f: Floe, angle: number): number {
  const t = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / ((Math.PI * 2) / FLOE_SPOKES);
  const i = Math.floor(t) % FLOE_SPOKES;
  const frac = t - Math.floor(t);
  return f.radii[i] * (1 - frac) + f.radii[(i + 1) % FLOE_SPOKES] * frac;
}

export function contains(f: Floe, p: Vec2): boolean {
  if (inHole(f, p)) return false;
  const q = toFloeSpace(f, p);
  return Math.hypot(q.x, q.y) <= radiusAt(f, Math.atan2(q.y, q.x));
}

/**
 * How much ice lies ahead of a world point in a given direction — used for
 * edge probing. Returns the floe-space margin (boundary radius minus the
 * point's floe-space distance); negative means already outside.
 */
export function marginAt(f: Floe, p: Vec2): number {
  const q = toFloeSpace(f, p);
  return radiusAt(f, Math.atan2(q.y, q.x)) - Math.hypot(q.x, q.y);
}

/**
 * Carve a blast of radius r (world units) centered at `at` out of the floe.
 * Each spoke ray passing through the blast circle is shortened to its entry
 * point, so a mid-floe blast opens a wedge to the water. Refuses to shrink
 * below FLOE_MIN_AREA_FRAC of the initial area (final-duel slab).
 */
export function breakChunk(f: Floe, at: Vec2, r: number): boolean {
  const b = toFloeSpace(f, at);
  const rr = r / ((f.sx + 1) / 2); // approximate the stretch for the blast size
  const bDist = Math.hypot(b.x, b.y);
  const bAngle = Math.atan2(b.y, b.x);
  const next = [...f.radii];
  for (let i = 0; i < FLOE_SPOKES; i++) {
    let phi = spokeAngle(i) - bAngle;
    phi = Math.atan2(Math.sin(phi), Math.cos(phi)); // wrap to [-PI, PI]
    const perp = Math.abs(bDist * Math.sin(phi));
    if (perp >= rr || Math.abs(phi) > Math.PI / 2) continue;
    const entry = bDist * Math.cos(phi) - Math.sqrt(rr * rr - perp * perp);
    if (entry < next[i]) next[i] = Math.max(entry, 0);
  }
  const candidate: Floe = { ...f, radii: next };
  if (area(candidate) < f.initialArea * FLOE_MIN_AREA_FRAC) return false;
  f.radii = next;
  return true;
}
