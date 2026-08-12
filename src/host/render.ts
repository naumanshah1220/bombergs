// v2 sprite renderer — new-pack terrain with real elevation, custom Pawn
// bomb animations, clouds overhead. ¾ top-down, Bomberman-style flipping.
//
// Layers: water → water rocks/ducks → foam → island (level-1 autotile, then
// raised level-2 plateau with cliff walls + stairs; cached by version) →
// deco → splashes → y-sorted actors (pawns with color rings, sheep, pickups,
// tumblers) → bomb layer → explosions → clouds → HUD cards.

import { BOMB, fuseFrac } from '../sim/bomb';
import { ARENA_H, ARENA_W, INVULN_MS, MAX_LIVES } from '../sim/constants';
import { TILE, cellCenter, cellIndex, groundCells, isGround, type Island } from '../sim/island';
import type { Penguin, Vec2, World, WorldEvent } from '../sim/world';
import { DECO_META, PAWN, type Assets } from './assets';

type Fx = { x: number; y: number; age: number };
type Tumble = { slot: number; x: number; y: number; vx: number; vy: number; age: number };

const UNIT = 176;

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private a: Assets;
  private t = 0;
  private splashFx: Fx[] = [];
  private booms: Fx[] = [];
  private shockwaves: Fx[] = [];
  private spray: (Fx & { vx: number; vy: number; color?: string })[] = [];
  private tumbles: Tumble[] = [];
  private throwUntil = new Map<number, number>();
  private facing = new Map<number, number>();
  private shake = 0;
  private flash = 0;
  private islandCache?: { canvas: HTMLCanvasElement; version: number };
  private deco: { x: number; y: number; img: 'bush1' | 'bush2' | 'bush3' | 'bush4' | 'rock1' | 'rock2' | 'rock3' | 'rock4' }[] = [];
  private clouds: { x: number; y: number; img: 'cloud1' | 'cloud2' | 'cloud3' | 'cloud4'; v: number }[] = [];
  private ducks: { x: number; y: number; v: number }[] = [];
  private sheep = { x: 0, y: 0, timer: 0, vx: 0, vy: 0 };
  private waterPattern?: CanvasPattern;
  private inited = false;

  constructor(canvas: HTMLCanvasElement, assets: Assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.a = assets;
  }

  private init(island: Island): void {
    if (this.inited) return;
    this.inited = true;
    this.waterPattern = this.ctx.createPattern(this.a.img.water, 'repeat')!;
    const cells = groundCells(island, 1);
    const rng = mulberry(777);
    const decoNames = ['bush1', 'bush2', 'bush3', 'bush4', 'rock1', 'rock2', 'rock3', 'rock4'] as const;
    for (let i = 0; i < 12 && cells.length; i++) {
      const pick = cells[Math.floor(rng() * cells.length)];
      const p = cellCenter(island, pick.c, pick.r);
      this.deco.push({ x: p.x, y: p.y, img: decoNames[i % decoNames.length] });
    }
    for (let i = 0; i < 4; i++) {
      this.clouds.push({
        x: rng() * ARENA_W,
        y: 60 + rng() * (ARENA_H - 200),
        img: (['cloud1', 'cloud2', 'cloud3', 'cloud4'] as const)[i],
        v: 8 + rng() * 10,
      });
    }
    this.ducks = [
      { x: 100, y: 80, v: 14 },
      { x: ARENA_W - 140, y: ARENA_H - 70, v: -11 },
    ];
    const s = cells.length ? cellCenter(island, cells[Math.floor(cells.length / 2)].c, cells[Math.floor(cells.length / 2)].r) : { x: ARENA_W / 2, y: ARENA_H / 2 };
    this.sheep = { x: s.x, y: s.y, timer: 0, vx: 0, vy: 0 };
  }

  addEvents(events: WorldEvent[], world: World): void {
    for (const e of events) {
      if (e.kind === 'splash') this.splashFx.push({ x: e.at.x, y: e.at.y, age: 0 });
      if (e.kind === 'throw') this.throwUntil.set(e.slot, this.t + 0.4);
      if (e.kind === 'explode') {
        this.shake = 1;
        this.flash = 0.3;
        this.booms.push({ x: e.at.x, y: e.at.y, age: 0 });
        this.shockwaves.push({ x: e.at.x, y: e.at.y, age: 0 });
      }
      if (e.kind === 'blink') {
        for (const spot of [e.from, e.to]) {
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            this.spray.push({ x: spot.x, y: spot.y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, age: 0, color: '#bfe9ff' });
          }
        }
      }
      if (e.kind === 'ricochet') {
        const p = world.penguins.find((q) => q.slot === e.slot);
        if (p) this.shockwaves.push({ x: p.pos.x, y: p.pos.y, age: 0.35 });
      }
    }
  }

  draw(w: World, dtMs: number): void {
    this.t += dtMs / 1000;
    this.init(w.island);
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    const c = this.ctx;
    c.imageSmoothingEnabled = false;

    const scale = Math.min(this.canvas.width / ARENA_W, this.canvas.height / ARENA_H);
    c.fillStyle = '#47aba9';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.save();
    c.translate((this.canvas.width - ARENA_W * scale) / 2, (this.canvas.height - ARENA_H * scale) / 2);
    c.scale(scale, scale);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dtMs / 400);
      const amp = this.shake * 12;
      c.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }

    this.waterLayer(c, dtMs);
    this.foamLayer(c, w.island);
    this.customDeco(c, w, true);
    this.islandLayer(c, w.island);
    this.decoLayer(c, w);
    this.actorsLayer(c, w, dtMs);
    this.bombLayer(c, w);
    this.updateBooms(c, dtMs);
    this.updateSplashes(c, dtMs);
    this.updateShockwaves(c, dtMs);
    this.updateSpray(c, dtMs);
    this.cloudLayer(c, dtMs);

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dtMs / 1000);
      c.fillStyle = `rgba(255, 240, 220, ${this.flash * 2})`;
      c.fillRect(0, 0, ARENA_W, ARENA_H);
    }
    c.restore();
    this.hudCards(c, w);
  }

  private waterLayer(c: CanvasRenderingContext2D, dtMs: number): void {
    if (this.waterPattern) {
      c.fillStyle = this.waterPattern;
      c.fillRect(0, 0, ARENA_W, ARENA_H);
    }
    const rf = Math.floor(this.t * 8) % 16;
    c.drawImage(this.a.img.waterrock1, rf * 64, 0, 64, 64, 60, 130, 64, 64);
    c.drawImage(this.a.img.waterrock2, rf * 64, 0, 64, 64, ARENA_W - 120, 90, 64, 64);
    c.drawImage(this.a.img.waterrock1, rf * 64, 0, 64, 64, ARENA_W - 90, ARENA_H - 150, 64, 64);
    const df = Math.floor(this.t * 5) % 3;
    for (const d of this.ducks) {
      d.x += d.v * dtMs / 1000;
      if (d.x > ARENA_W + 40) d.x = -40;
      if (d.x < -40) d.x = ARENA_W + 40;
      c.save();
      c.translate(d.x, d.y + Math.sin(this.t * 2 + d.y) * 3);
      if (d.v < 0) c.scale(-1, 1);
      c.drawImage(this.a.img.duck, df * 32, 0, 32, 32, -24, -24, 48, 48);
      c.restore();
    }
  }

  private land(i: Island, c: number, r: number, min = 1): boolean {
    if (c < 0 || r < 0 || c >= i.cols || r >= i.rows) return false;
    return i.cells[cellIndex(i, c, r)] >= min;
  }

  private foamLayer(c: CanvasRenderingContext2D, i: Island): void {
    const frame = Math.floor(this.t * 10) % 16;
    for (let r = 0; r < i.rows; r++) {
      for (let col = 0; col < i.cols; col++) {
        if (!this.land(i, col, r)) continue;
        if (this.land(i, col - 1, r) && this.land(i, col + 1, r) && this.land(i, col, r - 1) && this.land(i, col, r + 1)) continue;
        const p = cellCenter(i, col, r);
        c.drawImage(this.a.img.foam, frame * 192, 0, 192, 192, p.x - 96, p.y - 96, 192, 192);
      }
    }
  }

  private samePatch(i: Island, c2: number, r2: number, min: 1 | 2, skin: number): boolean {
    if (!this.land(i, c2, r2, min)) return false;
    return i.skins[r2 * i.cols + c2] === skin;
  }

  private autotileSrc(i: Island, col: number, r: number, min: 1 | 2): [number, number] {
    const skin = i.skins[r * i.cols + col];
    const L = this.samePatch(i, col - 1, r, min, skin);
    const R = this.samePatch(i, col + 1, r, min, skin);
    const U = this.samePatch(i, col, r - 1, min, skin);
    const D = this.samePatch(i, col, r + 1, min, skin);
    const sc = L && R ? 1 : R ? 0 : L ? 2 : 3;
    const sr = U && D ? 1 : D ? 0 : U ? 2 : 3;
    return [sc * 64, sr * 64];
  }

  private islandLayer(c: CanvasRenderingContext2D, i: Island): void {
    if (!this.islandCache || this.islandCache.version !== i.version) {
      const canvas = this.islandCache?.canvas ?? document.createElement('canvas');
      canvas.width = ARENA_W;
      canvas.height = ARENA_H;
      const ic = canvas.getContext('2d')!;
      ic.imageSmoothingEnabled = false;
      ic.clearRect(0, 0, ARENA_W, ARENA_H);
      const RAISE = 20;
      const sheetFor = (idx: number) =>
        (this.a.img as Record<string, HTMLImageElement>)['tilemap' + (i.skins[idx] ?? 1)] ?? this.a.img.tilemap1;
      for (let r = 0; r < i.rows; r++) {
        for (let col = 0; col < i.cols; col++) {
          if (!this.land(i, col, r)) continue;
          const [sx, sy] = this.autotileSrc(i, col, r, 1);
          ic.drawImage(sheetFor(r * i.cols + col), sx, sy, 64, 64, col * TILE, r * TILE, TILE, TILE);
        }
      }
      for (let r = 0; r < i.rows; r++) {
        for (let col = 0; col < i.cols; col++) {
          if (!this.land(i, col, r, 2)) continue;
          const sheet = sheetFor(r * i.cols + col);
          const southLower = !this.land(i, col, r + 1, 2);
          if (southLower) {
            // cliff wall filling the seam below the raised top
            const wl = this.land(i, col - 1, r, 2) && !this.land(i, col - 1, r + 1, 2);
            const wr = this.land(i, col + 1, r, 2) && !this.land(i, col + 1, r + 1, 2);
            const wx = wl && wr ? 6 : wr ? 5 : wl ? 7 : 8;
            ic.drawImage(sheet, wx * 64, 4 * 64, 64, 64, col * TILE, r * TILE + TILE - RAISE - 20, TILE, TILE);
            // soft automatic shadow at the cliff base (one long strip, no tiling seams)
            ic.fillStyle = 'rgba(20, 30, 20, .18)';
            ic.fillRect(col * TILE - 2, r * TILE + TILE + 4, TILE + 4, 14);
            ic.fillStyle = 'rgba(20, 30, 20, .10)';
            ic.fillRect(col * TILE - 2, r * TILE + TILE + 18, TILE + 4, 10);
          }
          const [sx, sy] = this.autotileSrc(i, col, r, 2);
          ic.drawImage(sheet, 320 + sx, sy, 64, 64, col * TILE, r * TILE - RAISE, TILE, TILE);
        }
      }
      for (const sidx of i.stairs) {
        const scol = sidx % i.cols;
        const srow = Math.floor(sidx / i.cols);
        ic.save();
        ic.translate(scol * TILE + TILE / 2, 0);
        if (i.stairsFlip.has(sidx)) ic.scale(-1, 1);
        ic.drawImage(sheetFor(sidx), 192, 256, 64, 128, -TILE / 2, srow * TILE - TILE, TILE, TILE * 2);
        ic.restore();
      }
      this.islandCache = { canvas, version: i.version };
    }
    c.drawImage(this.islandCache.canvas, 0, 0);
  }

  private customDeco(c: CanvasRenderingContext2D, w: World, under: boolean): void {
    if (!w.deco) return;
    for (const d of w.deco) {
      const img = (this.a.img as Record<string, HTMLImageElement>)[d.img];
      const meta = DECO_META[d.img];
      if (!img || !meta || Boolean(meta.under) !== under) continue;
      const frame = meta.frames > 1 ? Math.floor(this.t * meta.rate) % meta.frames : 0;
      const size = meta.fw * d.scale;
      const dh = size * (meta.fh / meta.fw);
      c.save();
      c.translate(d.x, d.y);
      c.rotate(d.rot);
      c.drawImage(img, frame * meta.fw, 0, meta.fw, meta.fh, -size / 2, -dh * 0.7, size, dh);
      c.restore();
    }
  }

  private decoLayer(c: CanvasRenderingContext2D, w?: World): void {
    if (w?.deco) {
      this.customDeco(c, w, false);
      return;
    }
    const bf = Math.floor(this.t * 7) % 8;
    for (const d of this.deco) {
      const img = this.a.img[d.img];
      if (d.img.startsWith('bush')) c.drawImage(img, bf * 128, 0, 128, 128, d.x - 40, d.y - 52, 80, 80);
      else c.drawImage(img, d.x - 24, d.y - 26, 48, 48);
    }
  }

  private actorsLayer(c: CanvasRenderingContext2D, w: World, dtMs: number): void {
    type Actor = { y: number; drawFn: () => void };
    const actors: Actor[] = [];
    const carrier = w.bomb.s === 'carried' ? w.bomb.slot : undefined;

    for (const p of w.penguins) {
      if (!p.alive) continue;
      actors.push({ y: p.pos.y, drawFn: () => this.pawn(c, p, p.slot === carrier) });
    }
    for (const pk of w.pickups) {
      const bob = Math.sin(this.t * 3 + pk.id) * 3;
      actors.push({
        y: pk.pos.y,
        drawFn: () => {
          c.save();
          c.translate(pk.pos.x, pk.pos.y + bob);
          if (pk.kind === 'heart') this.heart(c, 0, 0, 12, '#ff4560');
          else this.crate(c);
          c.restore();
        },
      });
    }
    this.stepSheep(w, dtMs);
    actors.push({
      y: this.sheep.y,
      drawFn: () => {
        const moving = Math.hypot(this.sheep.vx, this.sheep.vy) > 6;
        const frame = moving ? Math.floor(this.t * 8) % 4 : Math.floor(this.t * 6) % 6;
        const sheet = moving ? this.a.img.sheepMove : this.a.img.sheepIdle;
        c.save();
        c.translate(this.sheep.x, this.sheep.y);
        if (this.sheep.vx < 0) c.scale(-1, 1);
        c.drawImage(sheet, frame * 128, 0, 128, 128, -56, -78, 112, 112);
        c.restore();
      },
    });
    for (const tb of [...this.tumbles]) {
      tb.age += dtMs / 1000;
      tb.x += tb.vx * dtMs / 1000;
      tb.y += tb.vy * dtMs / 1000;
      tb.vy += 650 * dtMs / 1000;
      if (tb.age > 1.1) {
        this.tumbles = this.tumbles.filter((q) => q !== tb);
        continue;
      }
      actors.push({
        y: tb.y + 4000,
        drawFn: () => {
          const grow = 1 + Math.sin(Math.min(tb.age, 1) * Math.PI) * 0.9; // toward camera and back
          c.save();
          c.translate(tb.x, tb.y);
          c.rotate(tb.age * 11);
          c.globalAlpha = Math.min(1, 2.2 - tb.age * 2);
          const size = 90 * grow;
          c.drawImage(this.a.pawns[tb.slot % this.a.pawns.length].idle, 0, 0, PAWN.FW, PAWN.FH, -size / 2, -size / 2, size, size);
          c.restore();
          c.globalAlpha = 1;
        },
      });
    }
    actors.sort((x, z) => x.y - z.y);
    for (const a of actors) a.drawFn();
  }

  private pawn(c: CanvasRenderingContext2D, p: Penguin, carrying: boolean): void {
    const sheets = this.a.pawns[p.slot % this.a.pawns.length];
    const speed = Math.hypot(p.vel.x, p.vel.y);
    if (Math.abs(p.vel.x) > 10) this.facing.set(p.slot, Math.sign(p.vel.x));
    const face = this.facing.get(p.slot) ?? 1;

    // special states replace the normal body entirely
    if (p.sinkMs > 0) {
      // submerge BEHIND the waterline: clip to above the entry point, slide
      // the body down out of the clip — it visibly goes under, not over
      const t = 1 - p.sinkMs / 750;
      c.save();
      c.beginPath();
      c.rect(p.pos.x - UNIT, p.pos.y - UNIT * 1.2, UNIT * 2, UNIT * 1.2 + 10);
      c.clip();
      c.globalAlpha = Math.max(1 - t * 0.45, 0.4);
      c.drawImage(sheets.idle, 0, 0, PAWN.FW, PAWN.FH,
        p.pos.x - UNIT / 2, p.pos.y - UNIT * 0.62 + t * t * UNIT * 0.75, UNIT, UNIT);
      c.restore();
      // ripple at the waterline while going under
      c.save();
      c.globalAlpha = 0.5;
      c.strokeStyle = '#eaffff';
      c.lineWidth = 2.5;
      c.beginPath();
      c.ellipse(p.pos.x, p.pos.y + 6, 20 + t * 10, 8 + t * 3, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
      return;
    }
    if (p.thrownMs > 0) {
      const t = 1 - p.thrownMs / 900;
      const grow = 1 + Math.sin(Math.PI * t) * 0.9; // up toward the camera, back down
      c.save();
      c.translate(p.pos.x, p.pos.y - Math.sin(Math.PI * t) * 60);
      c.rotate(t * 9);
      const size = UNIT * 0.7 * grow;
      c.drawImage(sheets.idle, 0, 0, PAWN.FW, PAWN.FH, -size / 2, -size / 2, size, size);
      c.restore();
      return;
    }
    if (p.downMs > 0) {
      c.save();
      c.translate(p.pos.x, p.pos.y);
      c.rotate(Math.PI / 2);
      c.drawImage(sheets.idle, 0, 0, PAWN.FW, PAWN.FH, -UNIT / 2, -UNIT * 0.62, UNIT, UNIT);
      c.restore();
      return;
    }

    // player identity: bold color ring on the ground, always visible
    c.save();
    c.beginPath();
    c.ellipse(p.pos.x, p.pos.y + 8, 26, 12, 0, 0, Math.PI * 2);
    c.fillStyle = `${p.color}2e`;
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = p.color;
    c.stroke();
    c.restore();

    if (p.invulnMs > 0 && Math.floor((INVULN_MS - p.invulnMs) / 110) % 2 === 0) return;

    const sh = UNIT * 0.9;
    c.drawImage(this.a.img.shadow, p.pos.x - sh / 2, p.pos.y - sh / 2 + 6, sh, sh);

    const throwing = (this.throwUntil.get(p.slot) ?? 0) > this.t;
    c.save();
    c.translate(p.pos.x, p.pos.y);
    if (face < 0) c.scale(-1, 1);
    if (throwing) {
      const total = 0.4;
      const remain = (this.throwUntil.get(p.slot) ?? 0) - this.t;
      const frame = Math.min(2, Math.floor(((total - remain) / total) * 3));
      const fw = this.a.throwFrameW;
      const fh = this.a.throwFrameH;
      const dw = UNIT * (fw / 192);
      const dh = UNIT * (fh / 192);
      c.drawImage(sheets.throw, frame * fw, 0, fw, fh, -dw / 2, -dh * 0.62, dw, dh);
    } else {
      const sheet = carrying
        ? (speed > 20 ? sheets.bombRun : sheets.bombIdle)
        : (speed > 20 ? sheets.run : sheets.idle);
      const frames = speed > 20 ? PAWN.RUN_F : PAWN.IDLE_F;
      const rate = speed > 20 ? 12 : 8;
      const frame = Math.floor(this.t * rate) % frames;
      c.drawImage(sheet, frame * PAWN.FW, 0, PAWN.FW, PAWN.FH, -UNIT / 2, -UNIT * 0.62, UNIT, UNIT);
    }
    c.restore();

    if (p.shieldMs > 0) {
      c.save();
      c.globalAlpha = 0.35 + Math.sin(this.t * 10) * 0.08;
      c.fillStyle = '#9fdcff';
      c.strokeStyle = '#e8f8ff';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(p.pos.x, p.pos.y - 20, 42, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }

    c.font = 'bold 13px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(8, 16, 34, .5)';
    const tw = c.measureText(p.name).width;
    c.beginPath();
    c.roundRect(p.pos.x - tw / 2 - 6, p.pos.y - UNIT * 0.62 - 8, tw + 12, 17, 5);
    c.fill();
    c.fillStyle = p.color;
    c.fillText(p.name, p.pos.x, p.pos.y - UNIT * 0.62 + 5);
  }

  private hudCards(c: CanvasRenderingContext2D, w: World): void {
    c.imageSmoothingEnabled = false;
    let y = 10;
    for (const p of w.penguins) {
      const x = 10;
      c.globalAlpha = p.alive ? 1 : 0.4;
      c.drawImage(this.a.img.carved, x, y, 64, 64);
      c.save();
      c.beginPath();
      c.roundRect(x + 8, y + 8, 48, 44, 8);
      c.clip();
      c.drawImage(this.a.pawns[p.slot % this.a.pawns.length].idle, 58, 40, 76, 70, x + 4, y + 4, 56, 52);
      c.restore();
      c.drawImage(this.a.img.ribbon, x + 60, y + 6, 116, 38);
      c.font = 'bold 13px "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#3a2a14';
      c.fillText(p.name.slice(0, 11), x + 118, y + 29);
      if (p.alive) {
        for (let i = 0; i < Math.min(p.lives, MAX_LIVES); i++) {
          this.heart(c, x + 74 + i * 18, y + 54, 7, '#e6323f');
        }
      } else {
        c.fillText('OUT', x + 92, y + 60);
      }
      c.globalAlpha = 1;
      y += 70;
    }
  }

  private cloudLayer(c: CanvasRenderingContext2D, dtMs: number): void {
    c.save();
    c.globalAlpha = 0.88;
    for (const cl of this.clouds) {
      cl.x += cl.v * dtMs / 1000;
      if (cl.x > ARENA_W + 300) cl.x = -600;
      c.drawImage(this.a.img[cl.img], cl.x, cl.y, 432, 192);
    }
    c.restore();
  }

  private stepSheep(w: World, dtMs: number): void {
    const s = this.sheep;
    s.timer -= dtMs;
    if (s.timer <= 0) {
      s.timer = 1200 + Math.random() * 2600;
      const dir = Math.random() * Math.PI * 2;
      const still = Math.random() < 0.4;
      s.vx = still ? 0 : Math.cos(dir) * 45;
      s.vy = still ? 0 : Math.sin(dir) * 45;
    }
    const nx = s.x + s.vx * dtMs / 1000;
    const ny = s.y + s.vy * dtMs / 1000;
    if (isGround(w.island, { x: nx, y: ny })) {
      s.x = nx;
      s.y = ny;
    } else {
      s.vx *= -1;
      s.vy *= -1;
    }
  }

  private heart(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    c.save();
    c.translate(x, y);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, r);
    c.bezierCurveTo(-r * 1.4, 0, -r * 0.7, -r, 0, -r * 0.35);
    c.bezierCurveTo(r * 0.7, -r, r * 1.4, 0, 0, r);
    c.fill();
    c.restore();
  }

  private crate(c: CanvasRenderingContext2D): void {
    c.fillStyle = '#a5692e';
    c.strokeStyle = '#6e421a';
    c.lineWidth = 3;
    c.fillRect(-13, -13, 26, 26);
    c.strokeRect(-13, -13, 26, 26);
    c.beginPath();
    c.moveTo(-13, -13); c.lineTo(13, 13);
    c.moveTo(13, -13); c.lineTo(-13, 13);
    c.stroke();
    c.fillStyle = '#ffe9b0';
    c.font = 'bold 15px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.fillText('?', 0, 6);
  }

  private bombSprite(c: CanvasRenderingContext2D, x: number, y: number, size: number, frac: number, spinning: boolean): void {
    if (frac > 0.6) {
      c.save();
      c.globalAlpha = 0.3 + (frac - 0.6) * 1.2;
      c.shadowColor = '#ff3b30';
      c.shadowBlur = 22;
      c.beginPath();
      c.arc(x, y, size * 0.35, 0, Math.PI * 2);
      c.fillStyle = '#ff3b30';
      c.fill();
      c.restore();
    }
    const frame = spinning
      ? Math.floor(this.t * 20) % 11
      : Math.floor(this.t * (4 + frac * 12)) % 11;
    c.drawImage(this.a.img.bombroll, frame * 100, 0, 100, 100, x - size / 2, y - size / 2, size, size);
  }

  private bombLayer(c: CanvasRenderingContext2D, w: World): void {
    const b = w.bomb;
    const frac = fuseFrac(b);
    if (b.s === 'delivering') {
      const target = w.penguins.find((p) => p.slot === b.toSlot);
      if (!target) return;
      const t = Math.min(b.t / BOMB.SKUA_MS, 1);
      c.font = 'bold 36px "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#ff5a5f';
      c.fillText('!', target.pos.x, target.pos.y - 70 - Math.abs(Math.sin(this.t * 8)) * 8);
      this.bombSprite(c, target.pos.x, target.pos.y - 90 - (1 - t) * 420, 72, 0, true);
      return;
    }
    if (b.s === 'carried') {
      const me = w.penguins.find((p) => p.slot === b.slot);
      if (!me) return;
      c.save();
      c.translate(me.pos.x, me.pos.y);
      c.rotate(this.t * 0.7);
      c.setLineDash([20, 14]);
      c.lineWidth = 4;
      c.strokeStyle = `rgba(255, ${Math.round(120 - frac * 90)}, 90, ${0.5 + frac * 0.4})`;
      c.beginPath();
      c.arc(0, 0, BOMB.PASS_RADIUS, 0, Math.PI * 2);
      c.stroke();
      c.restore();
      // bomb art is baked into the carry sheets; add only the danger pulse
      if (frac > 0.55) {
        c.save();
        c.globalAlpha = (frac - 0.55) * 0.9;
        c.shadowColor = '#ff3b30';
        c.shadowBlur = 24;
        c.beginPath();
        c.arc(me.pos.x, me.pos.y - UNIT * 0.5, 16, 0, Math.PI * 2);
        c.fillStyle = '#ff3b30';
        c.fill();
        c.restore();
      }
      return;
    }
    if (b.s === 'flying') {
      const x = b.from.x + (b.to.x - b.from.x) * b.t01;
      const y = b.from.y + (b.to.y - b.from.y) * b.t01;
      const h = Math.sin(Math.PI * Math.min(b.t01, 1)) * 110;
      c.save();
      c.setLineDash([7, 7]);
      c.lineWidth = 3;
      c.strokeStyle = b.dodged ? 'rgba(200, 215, 230, .7)' : 'rgba(255, 90, 95, .85)';
      c.beginPath();
      c.arc(b.to.x, b.to.y, 34 * (1.4 - 0.4 * b.t01), 0, Math.PI * 2);
      c.stroke();
      c.restore();
      c.beginPath();
      c.ellipse(x, y, 13 - h * 0.05, 6 - h * 0.02, 0, 0, Math.PI * 2);
      c.fillStyle = 'rgba(20, 50, 40, .4)';
      c.fill();
      this.bombSprite(c, x, y - h, 64, fuseFrac(b), true);
      return;
    }
    if (b.s === 'ground') {
      c.save();
      c.globalAlpha = 0.14 + Math.abs(Math.sin(this.t * (2 + frac * 10))) * 0.12;
      c.fillStyle = '#ff5a5f';
      c.beginPath();
      c.arc(b.pos.x, b.pos.y, BOMB.BLAST_RADIUS, 0, Math.PI * 2);
      c.fill();
      c.restore();
      this.bombSprite(c, b.pos.x, b.pos.y, 58, frac, false);
    }
  }

  private updateBooms(c: CanvasRenderingContext2D, dtMs: number): void {
    for (const boom of this.booms) {
      boom.age += dtMs / 1000;
      const frame = Math.floor(boom.age * 16);
      if (frame < 8) {
        const s = 230;
        c.drawImage(this.a.img.explosion, frame * 192, 0, 192, 192, boom.x - s / 2, boom.y - s / 2, s, s);
      }
    }
    this.booms = this.booms.filter((b) => b.age * 16 < 8);
  }

  private updateSplashes(c: CanvasRenderingContext2D, dtMs: number): void {
    for (const s of this.splashFx) {
      s.age += dtMs / 1000;
      const frame = Math.floor(s.age * 16);
      if (frame < 9) {
        c.drawImage(this.a.img.splash, frame * 192, 0, 192, 192, s.x - 96, s.y - 96, 192, 192);
      }
    }
    this.splashFx = this.splashFx.filter((s) => s.age * 16 < 9);
  }

  private updateShockwaves(c: CanvasRenderingContext2D, dtMs: number): void {
    for (const s of this.shockwaves) {
      s.age += dtMs / 1000;
      const r = s.age * 520;
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.lineWidth = Math.max(12 - s.age * 20, 2);
      c.strokeStyle = `rgba(255, 210, 160, ${Math.max(0.7 - s.age * 1.3, 0)})`;
      c.stroke();
    }
    this.shockwaves = this.shockwaves.filter((s) => s.age < 0.6);
  }

  private updateSpray(c: CanvasRenderingContext2D, dtMs: number): void {
    const dt = dtMs / 1000;
    for (const s of this.spray) {
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
      c.globalAlpha = Math.max(0.8 - s.age, 0);
      c.fillStyle = s.color ?? '#ffffff';
      c.beginPath();
      c.arc(s.x, s.y, 4, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    this.spray = this.spray.filter((s) => s.age < 0.9);
  }
}

function mulberry(seed: number): () => number {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type { Vec2 };
