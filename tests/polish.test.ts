import { describe, expect, it } from 'vitest';
import { tryThrow } from '../src/sim/bomb';
import { botInputs } from '../src/sim/bots';
import { TUNE } from '../src/sim/constants';
import { cellIndex, destroyAt, generateIsland } from '../src/sim/island';
import { makeWorld, step } from '../src/sim/world';

const NO_BOMB = { bomb: false, edgeDeath: true, floeBreak: true, lives: 3 };

describe('stair-adjacent blast protection', () => {
  it('never destroys a tile touching a stair, but still destroys others', () => {
    const i = generateIsland(26, 16, () => 0.5);
    i.cells.fill(1);
    i.stairs.clear();
    i.stairsFlip.clear();
    // plateau cell with a stair at (10, 8); its landing sits at (9, 8)
    i.cells[cellIndex(i, 10, 8)] = 2;
    i.stairs.add(cellIndex(i, 10, 8));

    destroyAt(i, 9 * 64 + 32, 8 * 64 + 32); // landing beside the stair
    expect(i.cells[cellIndex(i, 9, 8)]).toBe(1);
    destroyAt(i, 10 * 64 + 32, 9 * 64 + 32); // diagonal/below neighbor
    expect(i.cells[cellIndex(i, 10, 9)]).toBe(1);

    destroyAt(i, 5 * 64 + 32, 3 * 64 + 32); // far from any stair
    expect(i.cells[cellIndex(i, 5, 3)]).toBe(0);
  });
});

describe('throw range is tunable', () => {
  it('a target out of range at a small radius becomes reachable at a large one', () => {
    const w = makeWorld(
      [{ slot: 0, name: 'A', color: '#fff' }, { slot: 1, name: 'B', color: '#000' }],
      () => 0.5,
    );
    w.island.cells.fill(1);
    w.penguins[0].pos = { x: 500, y: 500 };
    w.penguins[1].pos = { x: 630, y: 500 }; // 130px away
    const carried = (): void => {
      w.bomb = { s: 'carried', slot: 0, fuseMs: 9000, fuseTotal: 9000, prevSlot: -1, noTagBackMs: 0 };
    };

    const original = TUNE.THROW_RADIUS;
    try {
      TUNE.THROW_RADIUS = 100;
      carried();
      expect(tryThrow(w)).toBe(false); // 130 > 100, nothing to throw at

      TUNE.THROW_RADIUS = 180;
      carried();
      expect(tryThrow(w)).toBe(true);  // same positions, wider ring
    } finally {
      TUNE.THROW_RADIUS = original;
    }
  });
});

describe('bot elevation sense', () => {
  it('a bot alone on the plateau heads toward the stairs', () => {
    const w = makeWorld(
      [{ slot: 0, name: 'A', color: '#fff', isDummy: true }, { slot: 1, name: 'B', color: '#000' }],
      () => 0.5, NO_BOMB,
    );
    w.island.cells.fill(1);
    // plateau block at cols 8..11, rows 6..9 with one stair on its right edge
    for (let r = 6; r <= 9; r++) for (let c = 8; c <= 11; c++) w.island.cells[cellIndex(w.island, c, r)] = 2;
    w.island.stairs.clear();
    w.island.stairsFlip.clear();
    w.island.stairs.add(cellIndex(w.island, 11, 7));

    const bot = w.penguins[0];
    bot.pos = { x: 9 * 64 + 32, y: 8 * 64 + 32 }; // up top, away from the stair
    bot.heading = Math.PI; // facing away from it
    w.penguins[1].pos = { x: 3 * 64 + 32, y: 8 * 64 + 32 }; // everyone else below

    const out = botInputs(w, bot);
    // stair is behind the bot: steering must be a real turn command
    expect(Math.abs(out.steer)).toBeGreaterThan(0.2);
  });

  it('bots sliding toward water brake instead of coasting in', () => {
    const w = makeWorld([{ slot: 0, name: 'A', color: '#fff', isDummy: true }], () => 0.5, NO_BOMB);
    w.island.cells.fill(1);
    // water strip on the right half
    for (let r = 0; r < w.island.rows; r++) {
      for (let c = 14; c < w.island.cols; c++) w.island.cells[cellIndex(w.island, c, r)] = 0;
    }
    const bot = w.penguins[0];
    // Closer to the shore than its stopping distance, so turning alone cannot
    // save it — the only correct answer is to stop pushing.
    bot.pos = { x: 14 * 64 - 25, y: 8 * 64 + 32 };
    bot.heading = 0;                        // pointed straight at the water
    bot.vel = { x: TUNE.BASE_SPEED, y: 0 }; // already sliding at it

    const out = botInputs(w, bot);
    expect(out.throttle).toBe(0);
  });
});

describe('bot survival soak on an eroded island', () => {
  it('4 bots on a holey map rarely fall in the water', () => {
    let falls = 0;
    for (const seed of [1, 2, 3]) {
      let s = seed;
      const rand = (): number => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
      const w = makeWorld(
        [0, 1, 2, 3].map((n) => ({ slot: n, name: `B${n}`, color: '#fff', isDummy: true })),
        rand, NO_BOMB,
      );
      // nibble holes everywhere so shorelines are jagged, like late-game
      for (let n = 0; n < 30; n++) {
        const c = 3 + Math.floor(rand() * 20);
        const r = 3 + Math.floor(rand() * 10);
        destroyAt(w.island, c * 64 + 32, r * 64 + 32);
      }
      // Stand every bot on solid ground AFTER the erosion, so we measure bots
      // driving into water rather than bots that were dropped into it.
      const safe: { x: number; y: number }[] = [];
      for (let r = 1; r < w.island.rows - 1; r++) {
        for (let c = 1; c < w.island.cols - 1; c++) {
          const solid = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
            .every(([dc, dr]) => w.island.cells[cellIndex(w.island, c + dc, r + dr)] >= 1);
          if (solid) safe.push({ x: c * 64 + 32, y: r * 64 + 32 });
        }
      }
      w.penguins.forEach((p, n) => {
        p.pos = { ...safe[Math.floor((n / w.penguins.length) * safe.length)] };
        p.vel = { x: 0, y: 0 };
      });
      for (let t = 0; t < 60 * 30; t++) { // 30 simulated seconds
        const events = step(w, 1000 / 60);
        falls += events.filter((e) => e.kind === 'splash').length;
      }
    }
    // 4 bots x 30s x 3 seeds = 6 bot-minutes on a map that is ~half water.
    // A couple of slips is fine; constant swimming is the bug this guards
    // against (it caught 30 before bots learned to keep off the shoreline).
    console.log(`bot falls across 6 bot-minutes: ${falls}`);
    expect(falls).toBeLessThanOrEqual(6);
  });
});
