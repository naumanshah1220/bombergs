// Sprite loading + per-player recoloring. Art: "Tiny Swords" (old version,
// CC0) by Pixel Frog — Pawn workers, dynamite, terrain, props, UI.
//
// The pack ships pawns in 4 team colors; slots 4-7 get hue-rotated copies.

const FILES = {
  dynamite: 'dynamite.png',            // 6 frames, 64px
  explosions: 'explosions.png',        // 9 frames, 192px
  tilemap: 'tilemap_flat.png',         // 64px tiles: grass 4x4 blob at (0,0)
  elevation: 'tilemap_elevation.png',  // 64px tiles: plateau + cliff walls
  shadow: 'shadow.png',                // 192px unit shadow
  water: 'water.png',                  // 64px tile
  foam: 'foam.png',                    // 8 frames, 192px
  rocks1: 'rocks1.png',                // 8 frames, 128px
  rocks2: 'rocks2.png',
  sheep: 'sheep.png',                  // 6 frames, 128px (bouncing)
  deco1: 'deco1.png',
  deco9: 'deco9.png',
  deco10: 'deco10.png',
  carved: 'carved.png',                // 64px carved shield (portrait bg)
  ribbon: 'ribbon.png',                // 192x64 name ribbon
} as const;

export type SheetName = keyof typeof FILES;

/** Per-slot pawn source: base team sheet + optional hue rotation. */
const PAWN_VARIANTS: { src: string; hue: number }[] = [
  { src: 'pawn_red.png', hue: 0 },      // 0 red
  { src: 'pawn_yellow.png', hue: 0 },   // 1 yellow
  { src: 'pawn_red.png', hue: 120 },    // 2 green-ish
  { src: 'pawn_blue.png', hue: 0 },     // 3 blue
  { src: 'pawn_purple.png', hue: 0 },   // 4 purple
  { src: 'pawn_red.png', hue: 30 },     // 5 orange
  { src: 'pawn_purple.png', hue: 45 },  // 6 pink
  { src: 'pawn_blue.png', hue: 45 },    // 7 teal
];

/** Pawn sheet: 6 rows x 6 frames of 192px. */
export const PAWN = {
  FW: 192, FH: 192, FRAMES: 6,
  IDLE: 0, RUN: 1, BUILD: 2, CARRY_IDLE: 3, CARRY_RUN: 4,
};

export type TileRef = { sx: number; sy: number };

export type Assets = {
  img: Record<SheetName, HTMLImageElement>;
  pawns: CanvasImageSource[]; // index = slot
  wallTile: TileRef;          // cliff face from the elevation sheet
  plateauTile: TileRef;       // grassy top from the elevation sheet
};

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load sprite: ${src}`));
    img.src = `/sprites/${src}`;
  });
}

/**
 * The elevation sheet's exact layout varies between pack versions, so probe
 * it: the cliff WALL is the fully-opaque cell with the least green dominance,
 * the PLATEAU top is the most-green fully-opaque cell.
 */
function probeElevation(img: HTMLImageElement): { wall: TileRef; plateau: TileRef } {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  let wall: TileRef = { sx: 0, sy: 0 };
  let plateau: TileRef = { sx: 0, sy: 0 };
  let minGreen = Infinity;
  let maxGreen = -Infinity;
  for (let ry = 0; ry < img.height; ry += 64) {
    for (let rx = 0; rx < img.width; rx += 64) {
      const d = ctx.getImageData(rx, ry, 64, 64).data;
      let opaque = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k + 3] > 128) {
          opaque++;
          rSum += d[k];
          gSum += d[k + 1];
          bSum += d[k + 2];
        }
      }
      if (opaque < 64 * 64 * 0.95) continue;
      const dominance = gSum / Math.max(rSum + bSum, 1);
      if (dominance < minGreen) { minGreen = dominance; wall = { sx: rx, sy: ry }; }
      if (dominance > maxGreen) { maxGreen = dominance; plateau = { sx: rx, sy: ry }; }
    }
  }
  return { wall, plateau };
}

export async function loadAssets(): Promise<Assets> {
  const names = Object.keys(FILES) as SheetName[];
  const imgs = await Promise.all(names.map((n) => load(FILES[n])));
  const img = Object.fromEntries(names.map((n, i) => [n, imgs[i]])) as Assets['img'];

  const bases = new Map<string, HTMLImageElement>();
  for (const v of PAWN_VARIANTS) {
    if (!bases.has(v.src)) bases.set(v.src, await load(v.src));
  }
  const pawns: CanvasImageSource[] = PAWN_VARIANTS.map((v) => {
    const base = bases.get(v.src)!;
    if (v.hue === 0) return base;
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d')!;
    ctx.filter = `hue-rotate(${v.hue}deg)`;
    ctx.drawImage(base, 0, 0);
    return c;
  });

  const { wall, plateau } = probeElevation(img.elevation);
  return { img, pawns, wallTile: wall, plateauTile: plateau };
}
