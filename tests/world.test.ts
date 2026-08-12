import { describe, expect, it } from 'vitest';
import { TUNE } from '../src/sim/constants';

import { ARENA_H, ARENA_W } from '../src/sim/constants';
const CX = ARENA_W / 2;
const CY = ARENA_H / 2;
const BASE_SPEED = TUNE.BASE_SPEED;
const PENGUIN_RADIUS = TUNE.PENGUIN_RADIUS;
import { makeWorld, step } from '../src/sim/world';

const rand = () => 0.5;

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ slot: i, name: `P${i}`, color: '#fff' }));

describe('trolley physics', () => {
  it('travels roughly BASE_SPEED when going straight', () => {
    const w = makeWorld(players(1), rand);
    w.island.cells.fill(1);
    const p = w.penguins[0];
    p.pos = { x: 200, y: CY };
    p.heading = 0;
    p.vel = { x: BASE_SPEED, y: 0 }; // already at cruise
    const x0 = p.pos.x;
    for (let i = 0; i < 60; i++) step(w, 1000 / 60);
    expect(p.pos.x - x0).toBeCloseTo(BASE_SPEED, -1.2); // ~1s of travel, loose tolerance
  });

  it('curves symmetrically for opposite steer', () => {
    const wl = makeWorld(players(1), rand);
    const wr = makeWorld(players(1), rand);
    wl.island.cells.fill(1);
    wr.island.cells.fill(1);
    wl.penguins[0].pos = { x: 200, y: CY };
    wr.penguins[0].pos = { x: 200, y: CY };
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
    const start = CY;
    expect(wl.penguins[0].pos.y - start).toBeCloseTo(-(wr.penguins[0].pos.y - start), 5);
  });

  it('falling in costs a life and respawns; the last life eliminates', () => {
    const w = makeWorld(players(1), rand);
    const p = w.penguins[0];
    p.pos.x = 10000; // teleport into the ocean
    let events = step(w, 16);
    expect(p.alive).toBe(true);
    expect(p.lives).toBe(2);
    expect(p.invulnMs).toBeGreaterThan(0);
    expect(events.map((e) => e.kind)).toContain('splash');
    expect(events.map((e) => e.kind)).toContain('lifeLost');
    expect(events.map((e) => e.kind)).not.toContain('eliminated');
    // burn the remaining lives (letting each sink animation finish first)
    for (let i = 0; i < 2; i++) {
      for (let k = 0; k < 60; k++) step(w, 16); // finish sinking + respawn
      p.pos.x = 10000;
      p.invulnMs = 0;
      events = step(w, 16);
    }
    expect(p.alive).toBe(false);
    expect(events.map((e) => e.kind)).toContain('eliminated');
  });

  it('joystick input walks toward the stick and stops on release', () => {
    const w = makeWorld(players(1), rand);
    w.island.cells.fill(1);
    const p = w.penguins[0];
    p.pos = { x: CX, y: CY };
    p.heading = 0;
    p.move = { x: 0, y: 1 }; // push straight down
    for (let i = 0; i < 60; i++) step(w, 1000 / 60);
    expect(p.pos.y).toBeGreaterThan(CY + 60);
    expect(Math.abs(p.heading - Math.PI / 2)).toBeLessThan(0.1);
    const yStop = p.pos.y;
    p.move = { x: 0, y: 0 }; // release
    for (let i = 0; i < 60; i++) step(w, 1000 / 60);
    // slides ~BASE_SPEED/ICE_GRIP px while stopping on ice, then stands still
    expect(p.pos.y - yStop).toBeLessThan(TUNE.BASE_SPEED / 4);
  });

  it('a bomb-free rules world never delivers a bomb', () => {
    const w = makeWorld(players(2), rand, { bomb: false, edgeDeath: true, floeBreak: false, lives: 3 });
    for (let i = 0; i < 400; i++) step(w, 16); // > idle + skua time
    expect(w.bomb.s).toBe('idle');
  });

  it('separates overlapping penguins', () => {
    const w = makeWorld(players(2), rand);
    w.island.cells.fill(1);
    const [a, b] = w.penguins;
    a.pos = { x: CX, y: CY };
    b.pos = { x: CX + 4, y: CY };
    a.vel = b.vel = { x: 0, y: 0 };
    step(w, 16);
    const dist = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
    expect(dist).toBeGreaterThanOrEqual(PENGUIN_RADIUS * 2 - 0.01);
  });
});
