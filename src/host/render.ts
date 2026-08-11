// Sprite renderer — Tiny Swords tiles on the grid island. ¾ top-down: the
// world is seen from above, pawns are drawn side-on and flip with their
// walking direction (the Bomberman convention).
//
// Layers, back to front: water tile pattern → bobbing rocks → foam under
// land edges → autotiled island (cached, rebuilt on damage) → elevated
// ledges (cliff wall + plateau top) → deco → splash rings → y-sorted actors
// (pawns, sheep, pickups, tumbling blast victims) → bomb layer → explosions
// → screen-space HUD portrait cards → shake/flash.

import { BOMB, fuseFrac } from '../sim/bomb';
import { ARENA_H, ARENA_W, INVULN_MS, MAX_LIVES } from '../sim/constants';
import { TILE, cellCenter, cellIndex, groundCells, isGround, type Island } from '../sim/island';
import type { Penguin, Vec2, World, WorldEvent } from '../sim/world';
import { PAWN, type Assets } from './assets';

type Splash = { x: number; y: number; age: number };
type Spray = { x: number; y: number; vx: number; vy: number; age: number; color?: string };
type Shockwave = { x: number; y: number; age: number };
type Boom = { x: number; y: number; age: number };
type Tumble = { slot: number; x: number; y: number; vx: number; vy: number; age: number };

const UNIT = 176; // draw size of a 192px unit frame (slightly tightened)

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private a: Assets;
  private t = 0;
  private splashes: Splash[] = [];
  private spray: Spray[] = [];
  private shockwaves: Shockwave[] = [];
  private booms: Boom[] = [];
  private tumbles: Tumble[] = [];
  private throwUntil = new Map<number, number>();
  private facing = new Map<number, number>();
  private shake = 0;
  private flash = 0;
  private islandCache?: { canvas: HTMLCanvasElement; version: number };
  private decoSpots: { x: number; y: number; img: 'deco1' | 'deco9' | 'deco10' }[] = [];
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
    const cells = groundCells(island);
    const rng = mulberry(4242);
    const decoNames = ['deco1', 'deco9', 'deco10'] as const;
    for (let i = 0; i < 10 && cells.length; i++) {
      const pick = cells[Math.floor(rng() * cells.length)];
      const p = cellCenter(island, pick.c, pick.r);
      this.decoSpots.push({ x: p.x, y: p.y, img: decoNames[i % 3] });
    }
    const s = cells.length ? cellCenter(island, cells[0].c, cells[0].r) : { x: ARENA_W / 2, y: ARENA_H / 2 };
    this.sheep = { x: s.x, y: s.y, timer: 0, vx: 0, vy: 0 };
  }

  addEvents(events: WorldEvent[], world: World): void {
    for (const e of events) {
      if (e.kind === 'splash') this.splashes.push({ x: e.at.x, y: e.at.y, age: 0 });
      if (e.kind === 'throw') this.throwUntil.set(e.slot, this.t + 0.5);
      if (e.kind === 'explode') {
        this.shake = 1;
        this.flash = 0.3;
        this.booms.push({ x: e.at.x, y: e.at.y, age: 0 });
        this.shockwaves.push({ x: e.at.x, y: e.at.y, age: 0 });
      }
      if (e.kind === 'launched') {
        const ang = Math.random() * Math.PI * 2;
        this.tumbles.push({
          slot: e.slot, x: e.at.x, y: e.at.y,
          vx: Math.cos(ang) * 180, vy: Math.sin(ang) * 180 - 220,
          age: 0,
        });
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

    this.waterLayer(c);
    this.foamLayer(c, w.island);
    this.islandLayer(c, w.island);
    this.decoLayer(c);
    this.updateSplashes(c, dtMs);
    this.actorsLayer(c, w, dtMs);
    this.bombLayer(c, w);
    this.updateBooms(c, dtMs);
    this.updateShockwaves(c, dtMs);
    this.updateSpray(c, dtMs);

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dtMs / 1000);
      c.fillStyle = `rgba(255, 240, 220, ${this.flash * 2})`;
      c.fillRect(0, 0, ARENA_W, ARENA_H);
    }
    c.restore();

    this.hudCards(c, w, scale);
  }

  private waterLayer(c: CanvasRenderingContext2D): void {
    if (this.waterPattern) {
      c.fillStyle = this.waterPattern;
      c.fillRect(0, 0, ARENA_W, ARENA_H);
    }
    const rockFrame = Math.floor(this.t * 7) % 8;
    for (const [img, x, y] of [
      [this.a.img.rocks1, 40, 40],
      [this.a.img.rocks2, ARENA_W - 150, 60],
      [this.a.img.rocks1, ARENA_W - 130, ARENA_H - 120],
      [this.a.img.rocks2, 30, ARENA_H - 110],
    ] as const) {
      c.drawImage(img, rockFrame * 128, 0, 128, 128, x, y, 96, 96);
    }
  }

  private land(i: Island, cIdx: number, r: number): boolean {
    if (cIdx < 0 || r < 0 || cIdx >= i.cols || r >= i.rows) return false;
    return i.cells[cellIndex(i, cIdx, r)] !== 0;
  }

  private foamLayer(c: CanvasRenderingContext2D, i: Island): void {
    const frame = Math.floor(this.t * 9) % 8;
    for (let r = 0; r < i.rows; r++) {
      for (let col = 0; col < i.cols; col++) {
        if (!this.land(i, col, r)) continue;
        if (this.land(i, col - 1, r) && this.land(i, col + 1, r) && this.land(i, col, r - 1) && this.land(i, col, r + 1)) continue;
        const p = cellCenter(i, col, r);
        c.drawImage(this.a.img.foam, frame * 192, 0, 192, 192, p.x - 96, p.y - 96, 192, 192);
      }
    }
  }

  private islandLayer(c: CanvasRenderingContext2D, i: Island): void {
    if (!this.islandCache || this.islandCache.version !== i.version) {
      const canvas = this.islandCache?.canvas ?? document.createElement('canvas');
      canvas.width = ARENA_W;
      canvas.height = ARENA_H;
      const ic = canvas.getContext('2d')!;
      ic.imageSmoothingEnabled = false;
      ic.clearRect(0, 0, ARENA_W, ARENA_H);
      // base ground: 4x4 grass blob autotile (3x3 blob + strip pieces)
      for (let r = 0; r < i.rows; r++) {
        for (let col = 0; col < i.cols; col++) {
          if (!this.land(i, col, r)) continue;
          const L = this.land(i, col - 1, r);
          const R = this.land(i, col + 1, r);
          const U = this.land(i, col, r - 1);
          const D = this.land(i, col, r + 1);
          const sc = L && R ? 1 : R ? 0 : L ? 2 : 3;
          const sr = U && D ? 1 : D ? 0 : U ? 2 : 3;
          ic.drawImage(this.a.img.tilemap, sc * 64, sr * 64, 64, 64, col * TILE, r * TILE, TILE, TILE);
        }
      }
      // elevated ledges: cliff wall in the cell, grassy plateau raised above
      for (let r = 0; r < i.rows; r++) {
        for (let col = 0; col < i.cols; col++) {
          if (i.cells[cellIndex(i, col, r)] !== 2) continue;
          const w = this.a.wallTile;
          const p = this.a.plateauTile;
          ic.drawImage(this.a.img.elevation, w.sx, w.sy, 64, 64, col * TILE, r * TILE, TILE, TILE);
          ic.drawImage(this.a.img.elevation, p.sx, p.sy, 64, 64, col * TILE, r * TILE - 22, TILE, TILE);
        }
      }
      this.islandCache = { canvas, version: i.version };
    }
    c.drawImage(this.islandCache.canvas, 0, 0);
  }

  private decoLayer(c: CanvasRenderingContext2D): void {
    for (const d of this.decoSpots) {
      c.drawImage(this.a.img[d.img], d.x - 24, d.y - 32, 48, 48);
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
          c.beginPath();
          c.ellipse(0, 13 - bob, 14, 6, 0, 0, Math.PI * 2);
          c.fillStyle = 'rgba(30, 60, 40, .3)';
          c.fill();
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
        const frame = moving ? Math.floor(this.t * 10) % 6 : 0;
        c.save();
        c.translate(this.sheep.x, this.sheep.y);
        if (this.sheep.vx < 0) c.scale(-1, 1);
        c.drawImage(this.a.img.sheep, frame * 128, 0, 128, 128, -36, -50, 72, 72);
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
          c.save();
          c.translate(tb.x, tb.y);
          c.rotate(tb.age * 12);
          c.globalAlpha = Math.min(1, 2.2 - tb.age * 2);
          const sheet = this.a.pawns[tb.slot % this.a.pawns.length];
          c.drawImage(sheet, 0, 0, PAWN.FW, PAWN.FH, -40, -40, 80, 80);
          c.restore();
          c.globalAlpha = 1;
        },
      });
    }

    actors.sort((x, z) => x.y - z.y);
    for (const a of actors) a.drawFn();
  }

  private pawn(c: CanvasRenderingContext2D, p: Penguin, carrying: boolean): void {
    const sheet = this.a.pawns[p.slot % this.a.pawns.length];
    const speed = Math.hypot(p.vel.x, p.vel.y);
    if (Math.abs(p.vel.x) > 10) this.facing.set(p.slot, Math.sign(p.vel.x));
    const face = this.facing.get(p.slot) ?? 1;

    if (p.invulnMs > 0 && Math.floor((INVULN_MS - p.invulnMs) / 110) % 2 === 0) return;

    let row: number;
    let rate = 10;
    const throwing = (this.throwUntil.get(p.slot) ?? 0) > this.t;
    if (throwing) {
      row = PAWN.BUILD; // big overhead swing reads as the throw
      rate = 14;
    } else if (carrying) {
      row = speed > 20 ? PAWN.CARRY_RUN : PAWN.CARRY_IDLE;
    } else {
      row = speed > 20 ? PAWN.RUN : PAWN.IDLE;
      rate = speed > 20 ? 12 : 8;
    }
    const frame = Math.floor(this.t * rate) % PAWN.FRAMES;

    const sh = UNIT * 0.9;
    c.drawImage(this.a.img.shadow, p.pos.x - sh / 2, p.pos.y - sh / 2 + 6, sh, sh);
    c.save();
    c.translate(p.pos.x, p.pos.y);
    if (face < 0) c.scale(-1, 1);
    // frame characters stand around y≈130/192 → offset so feet meet pos
    c.drawImage(sheet, frame * PAWN.FW, row * PAWN.FH, PAWN.FW, PAWN.FH, -UNIT / 2, -UNIT * 0.62, UNIT, UNIT);
    c.restore();

    // the carried dynamite sits in the raised hands
    if (carrying) this.dynamite(c, p.pos.x, p.pos.y - UNIT * 0.44, 0.85, 0);

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

    // small name tag (portrait cards carry the detail)
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

  /** Screen-space HUD: carved-shield portrait, ribbon name, hearts. */
  private hudCards(c: CanvasRenderingContext2D, w: World, _scale: number): void {
    c.imageSmoothingEnabled = false;
    const CARD = 92;
    let y = 10;
    for (const p of w.penguins) {
      const x = 10;
      c.globalAlpha = p.alive ? 1 : 0.4;
      // shield with the pawn's face
      c.drawImage(this.a.img.carved, x, y, 64, 64);
      c.save();
      c.beginPath();
      c.roundRect(x + 8, y + 8, 48, 44, 8);
      c.clip();
      const sheet = this.a.pawns[p.slot % this.a.pawns.length];
      // head area of idle frame 0: roughly (60,42)-(132,114) in the 192 frame
      c.drawImage(sheet, 58, 40, 76, 70, x + 4, y + 4, 56, 52);
      c.restore();
      // ribbon with the name
      c.drawImage(this.a.img.ribbon, x + 60, y + 6, 116, 38);
      c.font = 'bold 13px "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#3a2a14';
      c.fillText(p.name.slice(0, 11), x + 118, y + 29);
      // hearts under the ribbon
      if (p.alive) {
        for (let i = 0; i < Math.min(p.lives, MAX_LIVES); i++) {
          this.heart(c, x + 74 + i * 18, y + 54, 7, '#e6323f');
        }
      } else {
        c.font = 'bold 14px "Segoe UI", sans-serif';
        c.fillStyle = '#3a2a14';
        c.fillText('OUT', x + 92, y + 60);
      }
      c.globalAlpha = 1;
      y += CARD - 22;
    }
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

  private dynamite(c: CanvasRenderingContext2D, x: number, y: number, scale: number, frac: number): void {
    const frame = Math.floor(this.t * (6 + frac * 14)) % 6;
    const s = 52 * scale;
    if (frac > 0.6) {
      c.save();
      c.globalAlpha = 0.3 + (frac - 0.6) * 1.2;
      c.shadowColor = '#ff3b30';
      c.shadowBlur = 22;
      c.beginPath();
      c.arc(x, y, s * 0.35, 0, Math.PI * 2);
      c.fillStyle = '#ff3b30';
      c.fill();
      c.restore();
    }
    c.drawImage(this.a.img.dynamite, frame * 64, 0, 64, 64, x - s / 2, y - s / 2, s, s);
  }

  private bombLayer(c: CanvasRenderingContext2D, w: World): void {
    const b = w.bomb;
    const frac = fuseFrac(b);

    if (b.s === 'delivering') {
      const target = w.penguins.find((p) => p.slot === b.toSlot);
      if (!target) return;
      const t = Math.min(b.t / BOMB.SKUA_MS, 1);
      const sy = target.pos.y - 90 - (1 - t) * 420;
      c.font = 'bold 36px "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#ff5a5f';
      c.fillText('!', target.pos.x, target.pos.y - 70 - Math.abs(Math.sin(this.t * 8)) * 8);
      this.dynamite(c, target.pos.x, sy, 1.2, 0);
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
      // (the dynamite itself is drawn in the carrier's raised hands)
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
      c.save();
      c.translate(x, y - h);
      c.rotate(this.t * 14);
      this.dynamite(c, 0, 0, 1, fuseFrac(b));
      c.restore();
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
      this.dynamite(c, b.pos.x, b.pos.y, 1, frac);
    }
  }

  private updateBooms(c: CanvasRenderingContext2D, dtMs: number): void {
    for (const boom of this.booms) {
      boom.age += dtMs / 1000;
      const frame = Math.floor(boom.age * 18);
      if (frame < 9) {
        const s = 230;
        c.drawImage(this.a.img.explosions, frame * 192, 0, 192, 192, boom.x - s / 2, boom.y - s / 2, s, s);
      }
    }
    this.booms = this.booms.filter((b) => b.age * 18 < 9);
  }

  private updateSplashes(c: CanvasRenderingContext2D, dtMs: number): void {
    for (const s of this.splashes) {
      s.age += dtMs / 1000;
      for (const mult of [1, 0.6]) {
        const r = (12 + s.age * 100) * mult;
        c.beginPath();
        c.arc(s.x, s.y, r, 0, Math.PI * 2);
        c.lineWidth = Math.max(6 - s.age * 5, 1) * mult;
        c.strokeStyle = `rgba(235, 250, 255, ${Math.max(0.85 - s.age, 0)})`;
        c.stroke();
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < 1.1);
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
      if (s.age <= 0) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
      const life = s.color ? 0.9 : 0.5;
      c.globalAlpha = Math.max(0.8 - (s.age / life) * 0.8, 0);
      c.fillStyle = s.color ?? '#ffffff';
      c.beginPath();
      c.arc(s.x, s.y, s.color ? 4 : 3, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    this.spray = this.spray.filter((s) => s.age < (s.color ? 0.9 : 0.5));
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
