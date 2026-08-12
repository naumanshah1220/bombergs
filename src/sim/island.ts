// The arena as a tile grid with ELEVATION: level 0 = water, 1 = low ground,
// 2 = high plateau. You change levels only via stair cells; cliff edges block
// walking (cover!). Blasts lower a cell one step (2→1→0=water); stairs blast
// down to low ground. Damage persists all match.

export const TILE = 64;

export type Cell = 0 | 1 | 2;
export type Island = {
  cols: number;
  rows: number;
  cells: Cell[];        // level per cell
  skins: number[];      // GROUND layer tilemap color 1-5 per cell
  topSkins: number[];   // PLATEAU layer tilemap color per cell
  stairs: Set<number>;  // cell indices that connect level 1 ↔ 2
  stairsFlip: Set<number>; // subset of stairs drawn mirrored (facing right)
  version: number;      // bumped on damage — renderers key caches on it
};

export type Vec2 = { x: number; y: number };

export const cellIndex = (i: Island, c: number, r: number): number => r * i.cols + c;

export function cellOf(wx: number, wy: number): { c: number; r: number } {
  return { c: Math.floor(wx / TILE), r: Math.floor(wy / TILE) };
}

export function cellAt(i: Island, wx: number, wy: number): Cell {
  const { c, r } = cellOf(wx, wy);
  if (c < 0 || r < 0 || c >= i.cols || r >= i.rows) return 0;
  return i.cells[cellIndex(i, c, r)];
}

export function isStairAt(i: Island, wx: number, wy: number): boolean {
  const { c, r } = cellOf(wx, wy);
  if (c < 0 || r < 0 || c >= i.cols || r >= i.rows) return false;
  return i.stairs.has(cellIndex(i, c, r));
}

/** Any land (level >= 1). */
export const isGround = (i: Island, p: Vec2): boolean => cellAt(i, p.x, p.y) >= 1;

/**
 * Can a walker standing at `from` step to `to`? Same level: yes. Different
 * land levels: only if either end is a stair cell. Into water: yes (that's
 * falling — the sim charges a life); onto nothing out of bounds: also water.
 */
export function canStep(i: Island, from: Vec2, to: Vec2): boolean {
  const a = cellAt(i, from.x, from.y);
  const b = cellAt(i, to.x, to.y);
  if (b === 0) return true; // walking into water is allowed (and fatal-ish)
  if (a === 0) return b === 1; // climbing out of water only onto low ground
  if (a === b) return true;
  return isStairAt(i, from.x, from.y) || isStairAt(i, to.x, to.y);
}

export function cellCenter(i: Island, c: number, r: number): Vec2 {
  return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
}

export function groundCells(i: Island, level?: Cell): { c: number; r: number }[] {
  const out: { c: number; r: number }[] = [];
  for (let r = 0; r < i.rows; r++) {
    for (let c = 0; c < i.cols; c++) {
      const v = i.cells[cellIndex(i, c, r)];
      if (level === undefined ? v >= 1 : v === level) out.push({ c, r });
    }
  }
  return out;
}

/**
 * Blobby island: low-ground base with nibbled corners, 2-3 raised plateaus
 * with guaranteed stairs, centered with a water margin all around.
 */
export function generateIsland(cols: number, rows: number, rand: () => number = Math.random): Island {
  const cells = new Array<Cell>(cols * rows).fill(0);
  const i: Island = { cols, rows, cells, skins: new Array(cols * rows).fill(1), topSkins: new Array(cols * rows).fill(1), stairs: new Set(), stairsFlip: new Set(), version: 0 };
  const left = 2;
  const top = 2;
  const right = cols - 3;
  const bottom = rows - 3;
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) cells[cellIndex(i, c, r)] = 1;
  }
  for (const [cc, cr] of [[left, top], [right, top], [left, bottom], [right, bottom]] as const) {
    const bite = 1 + Math.floor(rand() * 3);
    for (let dr = 0; dr <= bite; dr++) {
      for (let dc = 0; dc <= bite - dr; dc++) {
        const c = cc + (cc === left ? dc : -dc);
        const r = cr + (cr === top ? dr : -dr);
        cells[cellIndex(i, c, r)] = 0;
      }
    }
  }
  for (let n = 0; n < 8; n++) {
    const side = Math.floor(rand() * 4);
    const c = side < 2 ? (side === 0 ? left : right) : left + 1 + Math.floor(rand() * (right - left - 1));
    const r = side < 2 ? top + 1 + Math.floor(rand() * (bottom - top - 1)) : (side === 2 ? top : bottom);
    cells[cellIndex(i, c, r)] = 0;
  }
  // plateaus with stairs
  const patches = 2 + Math.floor(rand() * 2);
  for (let p = 0; p < patches; p++) {
    const pw = 2 + Math.floor(rand() * 3);
    const ph = 2 + Math.floor(rand() * 2);
    const pc = left + 2 + Math.floor(rand() * Math.max(right - left - pw - 3, 1));
    const pr = top + 2 + Math.floor(rand() * Math.max(bottom - top - ph - 3, 1));
    let placed = false;
    for (let r = pr; r < pr + ph; r++) {
      for (let c = pc; c < pc + pw; c++) {
        if (cells[cellIndex(i, c, r)] === 1) { cells[cellIndex(i, c, r)] = 2; placed = true; }
      }
    }
    if (placed) {
      // stairs sit on the LEFT or RIGHT edge of the plateau, facing outward
      // (never the top or bottom edge), with ground beside them
      const sr = pr + Math.floor(rand() * ph);
      const leftIdx = cellIndex(i, pc, sr);
      const rightIdx = cellIndex(i, pc + pw - 1, sr);
      if (rand() < 0.5 && cells[leftIdx] === 2 && cells[cellIndex(i, pc - 1, sr)] === 1) {
        i.stairs.add(leftIdx);
        i.stairsFlip.add(leftIdx); // mirrored to face the ground on its left
      } else if (cells[rightIdx] === 2 && cells[cellIndex(i, pc + pw, sr)] === 1) {
        i.stairs.add(rightIdx); // sprite's natural facing suits the right edge
      } else if (cells[leftIdx] === 2 && cells[cellIndex(i, pc - 1, sr)] === 1) {
        i.stairs.add(leftIdx);
        i.stairsFlip.add(leftIdx);
      }
    }
  }
  return i;
}

/** A hand-authored level from the map maker. */
export type DecoItem = { img: string; x: number; y: number; scale: number; rot: number };
export type LevelData = {
  name: string;
  skin?: number; // tilemap color 1-5
  cols: number;
  rows: number;
  cells: number[];
  skins?: number[];
  topSkins?: number[];
  stairs: number[];
  stairsFlip?: number[];
  deco: DecoItem[];
};

export function islandFromLevel(level: LevelData): Island {
  // legacy saves marked ground cells as stairs; in the current model a stair
  // is a plateau-edge cell — drop anything else or it opens invisible passages
  const validStairs = level.stairs.filter((idx) => level.cells[idx] === 2);
  return {
    cols: level.cols,
    rows: level.rows,
    cells: [...level.cells] as Cell[],
    skins: level.skins ? [...level.skins] : new Array(level.cols * level.rows).fill(level.skin ?? 1),
    topSkins: level.topSkins
      ? [...level.topSkins]
      : level.skins ? [...level.skins] : new Array(level.cols * level.rows).fill(level.skin ?? 1),
    stairs: new Set(validStairs),
    stairsFlip: new Set((level.stairsFlip ?? []).filter((idx) => level.cells[idx] === 2)),
    version: 0,
  };
}

/** Nearest stair cell center to a world point (bot pathing aid). */
export function nearestStair(i: Island, p: Vec2): Vec2 | undefined {
  let best: Vec2 | undefined;
  let bestD = Infinity;
  for (const idx of i.stairs) {
    const c = idx % i.cols;
    const r = Math.floor(idx / i.cols);
    const q = cellCenter(i, c, r);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/**
 * Blast damage: only LOW ground opens to water. Plateaus are indestructible
 * (a crater ringed by cliffs would be an inescapable pit) and stairs are
 * indestructible (destroying the only way down strands people — and farming
 * that would be too strong a strategy).
 */
export function destroyAt(i: Island, wx: number, wy: number): void {
  const { c, r } = cellOf(wx, wy);
  if (c < 0 || r < 0 || c >= i.cols || r >= i.rows) return;
  const idx = cellIndex(i, c, r);
  if (i.cells[idx] !== 1 || i.stairs.has(idx)) return;
  i.cells[idx] = 0;
  i.version++;
}
