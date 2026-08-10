import { describe, expect, it } from 'vitest';
import { TUNE } from '../src/sim/constants';

const BASE_SPEED = TUNE.BASE_SPEED;
const PENGUIN_RADIUS = TUNE.PENGUIN_RADIUS;
import { makeWorld, step } from '../src/sim/world';

const rand = () => 0.5;

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ slot: i, name: `P${i}`, color: '#fff' }));

describe('trolley physics', () => {
  it('travels roughly BASE_SPEED when going straight', () => {
    const w = makeWorld(players(1), rand);
    const p = w.penguins[0];
    p.heading = 0;
    p.vel = { x: BASE_SPEED, y: 0 }; // already at cruise
    const x0 = p.pos.x;
    for (let i = 0; i < 60; i++) step(w, 1000 / 60);
    expect(p.pos.x - x0).toBeCloseTo(BASE_SPEED, -1.2); // ~1s of travel, loose tolerance
  });

  it('curves symmetrically for opposite steer', () => {
    const wl = makeWorld(players(1), rand);
    const wr = makeWorld(players(1), rand);
    wl.penguins[0].heading = 0;
    wr.penguins[0].heading = 0;
    wl.penguins[0].steer = -1;
    wr.penguins[0].steer = 1;
    for (let i = 0; i < 30; i++) {
      step(wl, 1000 / 60);
      step(wr, 1000 / 60);
      wl.penguins[0].steer = -1;
      wr.penguins[0].steer = 1;
    }
    expect(wl.penguins[0].pos.x).toBeCloseTo(wr.penguins[0].pos.x, 5);
    expect(wl.penguins[0].pos.y - wl.penguins[0].pos.y).toBeCloseTo(0);
    // same forward progress, mirrored lateral drift around start row
    const start = makeWorld(players(1), rand).penguins[0].pos.y;
    expect(wl.penguins[0].pos.y - start).toBeCloseTo(-(wr.penguins[0].pos.y - start), 5);
  });

  it('eliminates a penguin that leaves the floe', () => {
    const w = makeWorld(players(1), rand);
    const p = w.penguins[0];
    p.pos.x = 10000; // teleport into the ocean
    const events = step(w, 16);
    expect(p.alive).toBe(false);
    expect(events.map((e) => e.kind)).toEqual(['splash', 'eliminated']);
  });

  it('separates overlapping penguins', () => {
    const w = makeWorld(players(2), rand);
    const [a, b] = w.penguins;
    a.pos = { x: w.floe.cx, y: w.floe.cy };
    b.pos = { x: w.floe.cx + 4, y: w.floe.cy };
    a.vel = b.vel = { x: 0, y: 0 };
    step(w, 16);
    const dist = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
    expect(dist).toBeGreaterThanOrEqual(PENGUIN_RADIUS * 2 - 0.01);
  });
});
