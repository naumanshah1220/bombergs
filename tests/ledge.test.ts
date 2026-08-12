import { describe, expect, it } from 'vitest';
import { makeWorld, step } from './src/sim/world';

describe('ledge blocking', () => {
  it('cannot walk from ground onto plateau without stairs', () => {
    const w = makeWorld([{ slot: 0, name: 'P', color: '#fff' }], () => 0.5);
    w.island.cells.fill(1);
    // plateau column at cell x=10..11, rows all
    for (let r = 0; r < w.island.rows; r++) {
      w.island.cells[r * w.island.cols + 10] = 2;
      w.island.cells[r * w.island.cols + 11] = 2;
    }
    w.island.stairs.clear();
    const p = w.penguins[0];
    p.pos = { x: 9 * 64 + 32, y: 8 * 64 + 32 };
    p.move = { x: 1, y: 0 }; // push right into the cliff
    for (let i = 0; i < 120; i++) step(w, 16);
    expect(p.pos.x).toBeLessThan(10 * 64); // must be stopped at the wall
  });
});
