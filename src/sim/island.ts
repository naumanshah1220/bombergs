// The arena as a tile grid — squarish island blob with elevated ledges,
// matching the Tiny Swords tileset instead of fighting it. Cells: water (you
// fall in), ground (walkable), elevated (blocks movement — cover!). Blasts
// flatten elevation, then punch ground through to water; damage persists all
// match, so the island slowly crumbles.

export const TILE = 64;

export type Cell = 0 | 1 | 2; // 0 water, 1 ground, 2 elevated
export type Island = {
  cols: number;
  rows: number;
  cells: Cell[];
  version: number; // bumped on damage — renderers key their tile cache on it
};

export type Vec2 = { x: number; y: number };

export const cellIndex = (i: Island, c: number, r: number): number => r * i.cols + c;

export function cellAt(i: Island, wx: number, wy: number): Cell {
  const c = Math.floor(wx / TILE);
  const r = Math.floor(wy / TILE);
  if (c < 0 || r < 0 || c >= i.cols || r >= i.rows) return 0;
  return i.cells[cellIndex(i, c, r)];
}

export const isGround = (i: Island, p: Vec2): boolean => cellAt(i, p.x, p.y) === 1;
export const isElevated = (i: Island, p: Vec2): boolean => cellAt(i, p.x, p.y) === 2;

export function cellCenter(i: Island, c: number, r: number): Vec2 {
  return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
}

export function groundCells(i: Island): { c: number; r: number }[] {
  const out: { c: number; r: number }[] = [];
  for (let r = 0; r < i.rows; r++) {
    for (let c = 0; c < i.cols; c++) {
      if (i.cells[cellIndex(i, c, r)] === 1) out.push({ c, r });
    }
  }
  return out;
}

/**
 * A blobby squarish island with nibbled corners and a few elevated ledges,
 * centered in a cols x rows arena grid with a water margin all around.
 */
export function generateIsland(cols: number, rows: number, rand: () => number = Math.random): Island {
  const cells = new Array<Cell>(cols * rows).fill(0);
  const i: Island = { cols, rows, cells, version: 0 };
  const left = 2;
  const top = 2;
  const right = cols - 3;
  const bottom = rows - 3;
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      cells[cellIndex(i, c, r)] = 1;
    }
  }
  // nibble the corners into a blob
  const nibbles: [number, number][] = [
    [left, top], [right, top], [left, bottom], [right, bottom],
  ];
  for (const [cc, cr] of nibbles) {
    const bite = 1 + Math.floor(rand() * 2);
    for (let dr = 0; dr <= bite; dr++) {
      for (let dc = 0; dc <= bite - dr; dc++) {
        const c = cc + (cc === left ? dc : -dc);
        const r = cr + (cr === top ? dr : -dr);
        cells[cellIndex(i, c, r)] = 0;
      }
    }
  }
  // a few random edge nibbles for organic silhouette
  for (let n = 0; n < 6; n++) {
    const side = Math.floor(rand() * 4);
    const c = side < 2 ? (side === 0 ? left : right) : left + 1 + Math.floor(rand() * (right - left - 1));
    const r = side < 2 ? top + 1 + Math.floor(rand() * (bottom - top - 1)) : (side === 2 ? top : bottom);
    cells[cellIndex(i, c, r)] = 0;
  }
  // elevated ledges: small patches away from the very center
  const patches = 3 + Math.floor(rand() * 2);
  for (let p = 0; p < patches; p++) {
    const pw = 1 + Math.floor(rand() * 2);
    const ph = 1 + Math.floor(rand() * 2);
    const pc = left + 1 + Math.floor(rand() * (right - left - pw - 1));
    const pr = top + 1 + Math.floor(rand() * (bottom - top - ph - 1));
    for (let r = pr; r < pr + ph; r++) {
      for (let c = pc; c < pc + pw; c++) {
        if (cells[cellIndex(i, c, r)] === 1) cells[cellIndex(i, c, r)] = 2;
      }
    }
  }
  return i;
}

/**
 * Blast damage at a world point: elevation flattens to ground, ground opens
 * to water. One cell — small holes, big consequences over a match.
 */
export function destroyAt(i: Island, wx: number, wy: number): void {
  const c = Math.floor(wx / TILE);
  const r = Math.floor(wy / TILE);
  if (c < 0 || r < 0 || c >= i.cols || r >= i.rows) return;
  const idx = cellIndex(i, c, r);
  if (i.cells[idx] === 2) i.cells[idx] = 1;
  else if (i.cells[idx] === 1) i.cells[idx] = 0;
  else return;
  i.version++;
}
