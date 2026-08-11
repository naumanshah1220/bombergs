// Sprite loading + per-player recoloring. Art: "Tiny Swords" (old version,
// CC0) by Pixel Frog — TNT goblins, dynamite, terrain, props.
//
// The pack ships goblins in 4 team colors; slots 4-7 get hue-rotated copies
// (the whole goblin shifts, skin included — different goblin clans, works).

const FILES = {
  dynamite: 'dynamite.png',     // 6 frames, 64px
  explosions: 'explosions.png', // 9 frames, 192px
  tilemap: 'tilemap_flat.png',  // 64px tiles, 10x4
  shadow: 'shadow.png',         // 192px unit shadow
  water: 'water.png',           // 64px tile
  foam: 'foam.png',             // 8 frames, 192px
  rocks1: 'rocks1.png',         // 8 frames, 128px
  rocks2: 'rocks2.png',
  sheep: 'sheep.png',           // 6 frames, 128px (bouncing)
  deco1: 'deco1.png',
  deco9: 'deco9.png',
  deco10: 'deco10.png',
  deco14: 'deco14.png',
} as const;

export type SheetName = keyof typeof FILES;

/** Per-slot goblin source: base team sheet + optional hue rotation. */
const GOBLIN_VARIANTS: { src: string; hue: number }[] = [
  { src: 'tnt_red.png', hue: 0 },      // 0 red
  { src: 'tnt_yellow.png', hue: 0 },   // 1 yellow
  { src: 'tnt_red.png', hue: 120 },    // 2 green-ish clan
  { src: 'tnt_blue.png', hue: 0 },     // 3 blue
  { src: 'tnt_purple.png', hue: 0 },   // 4 purple
  { src: 'tnt_red.png', hue: 30 },     // 5 orange clan
  { src: 'tnt_purple.png', hue: 45 },  // 6 pink clan
  { src: 'tnt_blue.png', hue: 45 },    // 7 teal clan
];

export const GOBLIN = { FW: 192, FH: 192, IDLE: 6, RUN: 6, THROW: 7 };

export type Assets = {
  img: Record<SheetName, HTMLImageElement>;
  goblins: CanvasImageSource[]; // index = slot
};

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load sprite: ${src}`));
    img.src = `/sprites/${src}`;
  });
}

export async function loadAssets(): Promise<Assets> {
  const names = Object.keys(FILES) as SheetName[];
  const imgs = await Promise.all(names.map((n) => load(FILES[n])));
  const img = Object.fromEntries(names.map((n, i) => [n, imgs[i]])) as Assets['img'];

  const bases = new Map<string, HTMLImageElement>();
  for (const v of GOBLIN_VARIANTS) {
    if (!bases.has(v.src)) bases.set(v.src, await load(v.src));
  }
  const goblins: CanvasImageSource[] = GOBLIN_VARIANTS.map((v) => {
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

  return { img, goblins };
}
