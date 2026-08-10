// Authoritative world state + step(). Pure logic: no DOM, no network, no
// rendering. The host calls step() at 60Hz and forwards the returned events.

import { ARENA_H, ARENA_W, FLOE_WOBBLE, TUNE } from './constants';
import { contains, makeFloe, radiusAt, type Floe, type Vec2 } from './floe';

export type Penguin = {
  slot: number;
  name: string;
  color: string;
  pos: Vec2;
  heading: number;   // radians, 0 = +x
  vel: Vec2;
  steer: number;     // [-1, 1] latest input
  speedMult: number;
  alive: boolean;
  isDummy: boolean;  // placeholder AI until bots land (drives in circles)
};

export type WorldEvent =
  | { kind: 'splash'; slot: number; at: Vec2 }
  | { kind: 'eliminated'; slot: number };

export type World = {
  penguins: Penguin[];
  floe: Floe;
  tick: number;
};

export function makeWorld(players: { slot: number; name: string; color: string; isDummy?: boolean }[], rand: () => number = Math.random): World {
  const floe = makeFloe(ARENA_W / 2, ARENA_H / 2, TUNE.FLOE_RADIUS, FLOE_WOBBLE, rand);
  const penguins = players.map((p, i) => {
    const angle = (i / players.length) * Math.PI * 2;
    const r = TUNE.FLOE_RADIUS * 0.55;
    return {
      slot: p.slot,
      name: p.name,
      color: p.color,
      pos: { x: floe.cx + Math.cos(angle) * r, y: floe.cy + Math.sin(angle) * r },
      heading: angle + Math.PI, // face inward
      vel: { x: 0, y: 0 },
      steer: 0,
      speedMult: 1,
      alive: true,
      isDummy: p.isDummy ?? false,
    };
  });
  return { penguins, floe, tick: 0 };
}

export function step(w: World, dtMs: number): WorldEvent[] {
  const dt = dtMs / 1000;
  const events: WorldEvent[] = [];
  w.tick++;

  for (const p of w.penguins) {
    if (!p.alive) continue;
    if (p.isDummy) p.steer = dummySteer(w, p);

    p.heading += p.steer * TUNE.TURN_RATE * dt;
    const thrust = {
      x: Math.cos(p.heading) * TUNE.BASE_SPEED * p.speedMult,
      y: Math.sin(p.heading) * TUNE.BASE_SPEED * p.speedMult,
    };
    const k = Math.min(TUNE.ICE_GRIP * dt, 1);
    p.vel.x += (thrust.x - p.vel.x) * k;
    p.vel.y += (thrust.y - p.vel.y) * k;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
  }

  // Trolley-vs-trolley: positional separation + a bump impulse along the normal.
  const alive = w.penguins.filter((p) => p.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const overlap = TUNE.PENGUIN_RADIUS * 2 - dist;
      if (overlap <= 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      a.pos.x -= nx * overlap / 2;
      a.pos.y -= ny * overlap / 2;
      b.pos.x += nx * overlap / 2;
      b.pos.y += ny * overlap / 2;
      const bump = 60;
      a.vel.x -= nx * bump;
      a.vel.y -= ny * bump;
      b.vel.x += nx * bump;
      b.vel.y += ny * bump;
    }
  }

  // Water check — off the floe means in the drink.
  for (const p of w.penguins) {
    if (!p.alive) continue;
    if (!contains(w.floe, p.pos)) {
      p.alive = false;
      events.push({ kind: 'splash', slot: p.slot, at: { ...p.pos } });
      events.push({ kind: 'eliminated', slot: p.slot });
    }
  }

  return events;
}

/**
 * Placeholder dummy driving until real bots: wander gently, but steer hard
 * toward the floe center whenever the path ahead runs out of ice.
 */
function dummySteer(w: World, p: Penguin): number {
  const lookAhead = 90;
  const fx = p.pos.x + Math.cos(p.heading) * lookAhead;
  const fy = p.pos.y + Math.sin(p.heading) * lookAhead;
  const dx = fx - w.floe.cx;
  const dy = fy - w.floe.cy;
  const margin = radiusAt(w.floe, Math.atan2(dy, dx)) - Math.hypot(dx, dy);
  if (margin < 60) {
    // steer toward center: pick the turn direction that faces us inward
    const toCenter = Math.atan2(w.floe.cy - p.pos.y, w.floe.cx - p.pos.x);
    let diff = toCenter - p.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    return Math.sign(diff);
  }
  return Math.sin(w.tick / 90 + p.slot * 2) * 0.5;
}
