// v2 sprite loading — new-pack terrain/FX/props + the user's custom
// bomb-carrying/throwing Pawn sheets. All 8 player slots are generated from
// the Yellow base sheets by dyeing the two tunic palette entries to the
// bright PLAYER_COLORS — maximum tell-apart-ability at couch distance.

import { PLAYER_COLORS } from '../shared/protocol';

const V2 = {
  tilemap1: 'v2/tilemap1.png',     // 9x6 64px: flat block (0,0), elev block (5,0), walls row 4, stairs col 3 rows 4-5
  tilemap2: 'v2/tilemap2.png',     // same layout, other grass colors below
  tilemap3: 'v2/tilemap3.png',
  tilemap4: 'v2/tilemap4.png',
  tilemap5: 'v2/tilemap5.png',
  water: 'v2/water.png',
  foam: 'v2/foam.png',             // 16 frames, 192
  shadow: 'v2/shadow.png',
  explosion: 'v2/explosion.png',   // 8 frames, 192
  splash: 'v2/splash.png',         // 9 frames, 192
  bombroll: 'v2/bombroll.png',     // 11 frames, 100 (custom)
  dust: 'v2/dust.png',             // 8 frames, 64
  cloud1: 'v2/cloud1.png', cloud2: 'v2/cloud2.png', cloud3: 'v2/cloud3.png', cloud4: 'v2/cloud4.png',
  duck: 'v2/duck.png',             // 3 frames, 32
  waterrock1: 'v2/waterrock1.png', // 16 frames, 64
  waterrock2: 'v2/waterrock2.png',
  bush1: 'v2/bush1.png', bush2: 'v2/bush2.png', bush3: 'v2/bush3.png', bush4: 'v2/bush4.png',
  rock1: 'v2/rock1.png', rock2: 'v2/rock2.png', rock3: 'v2/rock3.png', rock4: 'v2/rock4.png',
  sheepIdle: 'v2/sheep_idle.png',  // 6 frames, 128
  sheepMove: 'v2/sheep_move.png',  // 4 frames, 128
  tree1: 'v2/tree1.png', tree2: 'v2/tree2.png', // 6 frames, 256
  tree3: 'v2/tree3.png', tree4: 'v2/tree4.png',
  waterrock3: 'v2/waterrock3.png', waterrock4: 'v2/waterrock4.png',
  house_blue: 'v2/house_blue.png', house_red: 'v2/house_red.png',
  house_yellow: 'v2/house_yellow.png', house_purple: 'v2/house_purple.png',
  house_black: 'v2/house_black.png',
  bld_archery_blue: 'v2/bld_archery_blue.png',
  bld_archery_red: 'v2/bld_archery_red.png',
  bld_archery_yellow: 'v2/bld_archery_yellow.png',
  bld_archery_purple: 'v2/bld_archery_purple.png',
  bld_archery_black: 'v2/bld_archery_black.png',
  bld_barracks_blue: 'v2/bld_barracks_blue.png',
  bld_barracks_red: 'v2/bld_barracks_red.png',
  bld_barracks_yellow: 'v2/bld_barracks_yellow.png',
  bld_barracks_purple: 'v2/bld_barracks_purple.png',
  bld_barracks_black: 'v2/bld_barracks_black.png',
  bld_castle_blue: 'v2/bld_castle_blue.png',
  bld_castle_red: 'v2/bld_castle_red.png',
  bld_castle_yellow: 'v2/bld_castle_yellow.png',
  bld_castle_purple: 'v2/bld_castle_purple.png',
  bld_castle_black: 'v2/bld_castle_black.png',
  bld_house1_blue: 'v2/bld_house1_blue.png',
  bld_house1_red: 'v2/bld_house1_red.png',
  bld_house1_yellow: 'v2/bld_house1_yellow.png',
  bld_house1_purple: 'v2/bld_house1_purple.png',
  bld_house1_black: 'v2/bld_house1_black.png',
  bld_house2_blue: 'v2/bld_house2_blue.png',
  bld_house2_red: 'v2/bld_house2_red.png',
  bld_house2_yellow: 'v2/bld_house2_yellow.png',
  bld_house2_purple: 'v2/bld_house2_purple.png',
  bld_house2_black: 'v2/bld_house2_black.png',
  bld_house3_blue: 'v2/bld_house3_blue.png',
  bld_house3_red: 'v2/bld_house3_red.png',
  bld_house3_yellow: 'v2/bld_house3_yellow.png',
  bld_house3_purple: 'v2/bld_house3_purple.png',
  bld_house3_black: 'v2/bld_house3_black.png',
  bld_monastery_blue: 'v2/bld_monastery_blue.png',
  bld_monastery_red: 'v2/bld_monastery_red.png',
  bld_monastery_yellow: 'v2/bld_monastery_yellow.png',
  bld_monastery_purple: 'v2/bld_monastery_purple.png',
  bld_monastery_black: 'v2/bld_monastery_black.png',
  bld_tower_blue: 'v2/bld_tower_blue.png',
  bld_tower_red: 'v2/bld_tower_red.png',
  bld_tower_yellow: 'v2/bld_tower_yellow.png',
  bld_tower_purple: 'v2/bld_tower_purple.png',
  bld_tower_black: 'v2/bld_tower_black.png',
  carved: 'carved.png',
  ribbon: 'ribbon.png',
} as const;

export type SheetName = keyof typeof V2;

/** Pawn animation sheets (192px frames unless noted). */
export type PawnSheets = {
  idle: CanvasImageSource;      // 8 frames
  run: CanvasImageSource;       // 6 frames
  bombIdle: CanvasImageSource;  // 8 frames (custom)
  bombRun: CanvasImageSource;   // 6 frames (custom)
  throw: CanvasImageSource;     // 3 frames of ~199x200 (custom)
};

export type Assets = {
  img: Record<SheetName, HTMLImageElement>;
  pawns: PawnSheets[]; // index = slot
  throwFrameW: number;
  throwFrameH: number;
};

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load sprite: ${src}`));
    img.src = `/sprites/${src}`;
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Find the (few) palette entries that differ between two aligned sheets. */
function diffKeys(a: HTMLImageElement, b: HTMLImageElement): [number, number, number][] {
  const ca = document.createElement('canvas');
  ca.width = a.width; ca.height = a.height;
  const xa = ca.getContext('2d')!;
  xa.drawImage(a, 0, 0);
  const da = xa.getImageData(0, 0, a.width, a.height).data;
  const cb = document.createElement('canvas');
  cb.width = b.width; cb.height = b.height;
  const xb = cb.getContext('2d')!;
  xb.drawImage(b, 0, 0);
  const db = xb.getImageData(0, 0, b.width, b.height).data;
  const keys = new Map<string, [number, number, number]>();
  const n = Math.min(da.length, db.length);
  for (let k = 0; k < n; k += 4) {
    if (da[k + 3] > 10 && db[k + 3] > 10 &&
        (da[k] !== db[k] || da[k + 1] !== db[k + 1] || da[k + 2] !== db[k + 2])) {
      keys.set(`${da[k]},${da[k + 1]},${da[k + 2]}`, [da[k], da[k + 1], da[k + 2]]);
    }
  }
  return [...keys.values()];
}

/** Recolor `sheet`, mapping tunic keys to a player color (+darker shade). */
function dye(sheet: HTMLImageElement, keys: [number, number, number][], color: string): HTMLCanvasElement {
  const [pr, pg, pb] = hexToRgb(color);
  // brighter key -> player color; darker key -> 62% shade
  const sorted = [...keys].sort((x, y) => (y[0] + y[1] + y[2]) - (x[0] + x[1] + x[2]));
  const canvas = document.createElement('canvas');
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(sheet, 0, 0);
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = im.data;
  const TOL = 42 * 42; // catch antialiased fringe pixels around the tunic
  for (let k = 0; k < d.length; k += 4) {
    if (d[k + 3] <= 10) continue;
    for (let s = 0; s < sorted.length; s++) {
      const [kr, kg, kb] = sorted[s];
      const dist = (d[k] - kr) ** 2 + (d[k + 1] - kg) ** 2 + (d[k + 2] - kb) ** 2;
      if (dist < TOL) {
        const f = s === 0 ? 1 : 0.62;
        // preserve the pixel's own brightness relative to the key
        const lum = (d[k] + d[k + 1] + d[k + 2]) / Math.max(kr + kg + kb, 1);
        d[k] = Math.min(255, Math.round(pr * f * lum));
        d[k + 1] = Math.min(255, Math.round(pg * f * lum));
        d[k + 2] = Math.min(255, Math.round(pb * f * lum));
        break;
      }
    }
  }
  ctx.putImageData(im, 0, 0);
  return canvas;
}

export async function loadAssets(): Promise<Assets> {
  const names = Object.keys(V2) as SheetName[];
  const imgs = await Promise.all(names.map((n) => load(V2[n])));
  const img = Object.fromEntries(names.map((n, i) => [n, imgs[i]])) as Assets['img'];

  // base sheets (yellow) + a red pack sheet to learn the tunic palette keys
  const [yIdle, yRun, yBombIdle, yBombRun, yThrow, rIdle] = await Promise.all([
    load('v2/pawn_yellow_idle.png'),
    load('v2/pawn_yellow_run.png'),
    load('v2/pawn_yellow_bombidle.png'),
    load('v2/pawn_yellow_bombrun.png'),
    load('v2/pawn_yellow_throw.png'),
    load('v2/pawn_red_idle.png'),
  ]);
  const keys = diffKeys(yIdle, rIdle);

  const pawns: PawnSheets[] = PLAYER_COLORS.map((color) => ({
    idle: dye(yIdle, keys, color),
    run: dye(yRun, keys, color),
    bombIdle: dye(yBombIdle, keys, color),
    bombRun: dye(yBombRun, keys, color),
    throw: dye(yThrow, keys, color),
  }));

  return {
    img,
    pawns,
    throwFrameW: Math.floor(yThrow.width / 3),
    throwFrameH: yThrow.height,
  };
}

/** Placeable decoration metadata: frame width/height, frame count, anim fps.
 * Shared by the map maker palette and the in-game renderer. */
export const DECO_META: Record<string, { fw: number; fh: number; frames: number; rate: number; under?: boolean }> = {
  tree1: { fw: 192, fh: 256, frames: 8, rate: 7 },
  tree2: { fw: 192, fh: 256, frames: 8, rate: 7 },
  tree3: { fw: 192, fh: 256, frames: 8, rate: 7 },
  tree4: { fw: 192, fh: 256, frames: 8, rate: 7 },
  bush1: { fw: 128, fh: 128, frames: 8, rate: 7 },
  bush2: { fw: 128, fh: 128, frames: 8, rate: 7 },
  bush3: { fw: 128, fh: 128, frames: 8, rate: 7 },
  bush4: { fw: 128, fh: 128, frames: 8, rate: 7 },
  rock1: { fw: 64, fh: 64, frames: 1, rate: 0 },
  rock2: { fw: 64, fh: 64, frames: 1, rate: 0 },
  rock3: { fw: 64, fh: 64, frames: 1, rate: 0 },
  rock4: { fw: 64, fh: 64, frames: 1, rate: 0 },
  waterrock1: { fw: 64, fh: 64, frames: 16, rate: 8 },
  waterrock2: { fw: 64, fh: 64, frames: 16, rate: 8 },
  waterrock3: { fw: 64, fh: 64, frames: 16, rate: 8 },
  waterrock4: { fw: 64, fh: 64, frames: 16, rate: 8 },
  duck: { fw: 32, fh: 32, frames: 3, rate: 5 },
  sheepIdle: { fw: 128, fh: 128, frames: 6, rate: 6 },
  shadow: { fw: 192, fh: 192, frames: 1, rate: 0, under: true },
  foam: { fw: 192, fh: 192, frames: 16, rate: 10, under: true },
  bld_archery_blue: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_archery_red: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_archery_yellow: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_archery_purple: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_archery_black: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_barracks_blue: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_barracks_red: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_barracks_yellow: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_barracks_purple: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_barracks_black: { fw: 192, fh: 256, frames: 1, rate: 0 },
  bld_castle_blue: { fw: 320, fh: 256, frames: 1, rate: 0 },
  bld_castle_red: { fw: 320, fh: 256, frames: 1, rate: 0 },
  bld_castle_yellow: { fw: 320, fh: 256, frames: 1, rate: 0 },
  bld_castle_purple: { fw: 320, fh: 256, frames: 1, rate: 0 },
  bld_castle_black: { fw: 320, fh: 256, frames: 1, rate: 0 },
  bld_house1_blue: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house1_red: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house1_yellow: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house1_purple: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house1_black: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house2_blue: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house2_red: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house2_yellow: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house2_purple: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house2_black: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house3_blue: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house3_red: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house3_yellow: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house3_purple: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_house3_black: { fw: 128, fh: 192, frames: 1, rate: 0 },
  bld_monastery_blue: { fw: 192, fh: 320, frames: 1, rate: 0 },
  bld_monastery_red: { fw: 192, fh: 320, frames: 1, rate: 0 },
  bld_monastery_yellow: { fw: 192, fh: 320, frames: 1, rate: 0 },
  bld_monastery_purple: { fw: 192, fh: 320, frames: 1, rate: 0 },
  bld_monastery_black: { fw: 192, fh: 320, frames: 1, rate: 0 },
  bld_tower_blue: { fw: 128, fh: 256, frames: 1, rate: 0 },
  bld_tower_red: { fw: 128, fh: 256, frames: 1, rate: 0 },
  bld_tower_yellow: { fw: 128, fh: 256, frames: 1, rate: 0 },
  bld_tower_purple: { fw: 128, fh: 256, frames: 1, rate: 0 },
  bld_tower_black: { fw: 128, fh: 256, frames: 1, rate: 0 },
  house_blue: { fw: 128, fh: 192, frames: 1, rate: 0 },
  house_red: { fw: 128, fh: 192, frames: 1, rate: 0 },
  house_yellow: { fw: 128, fh: 192, frames: 1, rate: 0 },
  house_purple: { fw: 128, fh: 192, frames: 1, rate: 0 },
  house_black: { fw: 128, fh: 192, frames: 1, rate: 0 },
};

export const PAWN = { FW: 192, FH: 192, IDLE_F: 8, RUN_F: 6 };
