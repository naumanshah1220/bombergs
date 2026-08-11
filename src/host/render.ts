// Sprite renderer — Tiny Swords art on the same 2D sim. ¾ top-down: the
// island is seen from above, goblins are drawn side-on and flip with their
// walking direction (the Bomberman convention).
//
// Layers, back to front: water tile pattern → bobbing rocks → animated foam
// ring under the island edge → island (ground pattern, cached; holes punched
// out) → deco → splash rings → y-sorted actors (goblins, sheep, pickups,
// tumbling blast victims) → bomb layer → explosions → HUD chips → shake/flash.

import { BOMB, fuseFrac } from '../sim/bomb';
import { ARENA_H, ARENA_W, INVULN_MS, TUNE } from '../sim/constants';
import { contains, spokeAngle, type Floe, type Vec2 } from '../sim/floe';
import type { Penguin, World, WorldEvent } from '../sim/world';
import { GOBLIN, type Assets } from './assets';

type Splash = { x: number; y: number; age: number };
type Spray = { x: number; y: number; vx: number; vy: number; age: number; color?: string };
type Shockwave = { x: number; y: number; age: number };
type Boom = { x: number; y: number; age: number };
type Tumble = { slot: number; x: number; y: number; vx: number; vy: number; age: number };
type ThrowAnim = { until: number };

const FOAM_SPACING = 58;

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
  private throwAnims = new Map<number, ThrowAnim>();
  private facing = new Map<number, number>(); // slot → 1 | -1
  private shake = 0;
  private flash = 0;
  private islandCache?: { canvas: HTMLCanvasElement; holes: number };
  private foamSpots: Vec2[] = [];
  private decoSpots: { x: number; y: number; img: 'deco1' | 'deco9' | 'deco10' }[] = [];
  private sheep = { x: 0, y: 0, dir: 0, timer: 0, vx: 0, vy: 0 };
  private groundPattern?: CanvasPattern;
  private waterPattern?: CanvasPattern;

  constructor(canvas: HTMLCanvasElement, assets: Assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.a = assets;
  }

  private initForFloe(f: Floe): void {
    if (this.foamSpots.length) return;
    // foam anchors along the boundary
    let prev: Vec2 | undefined;
    for (let i = 0; i < f.radii.length; i++) {
      const a = spokeAngle(i);
      const p = { x: f.cx + Math.cos(a) * f.radii[i] * f.sx, y: f.cy + Math.sin(a) * f.radii[i] };
      if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > FOAM_SPACING) {
        this.foamSpots.push(p);
        prev = p;
      }
    }
    // scattered walk-over decorations, safely inside
    const rng = mulberry(4242);
    const decoNames = ['deco1', 'deco9', 'deco10'] as const;
    for (let i = 0; i < 14; i++) {
      const ang = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 0.75;
      this.decoSpots.push({
        x: f.cx + Math.cos(ang) * TUNE.FLOE_RADIUS * d * f.sx,
        y: f.cy + Math.sin(ang) * TUNE.FLOE_RADIUS * d,
        img: decoNames[i % 3],
      });
    }
    this.sheep = { x: f.cx + 180, y: f.cy - 120, dir: 0, timer: 0, vx: 0, vy: 0 };
    // tile patterns: ground = grass block center tile (64,64); water = whole tile
    const tile = document.createElement('canvas');
    tile.width = tile.height = 64;
    tile.getContext('2d')!.drawImage(this.a.img.tilemap, 64, 64, 64, 64, 0, 0, 64, 64);
    this.groundPattern = this.ctx.createPattern(tile, 'repeat')!;
    this.waterPattern = this.ctx.createPattern(this.a.img.water, 'repeat')!;
  }

  addEvents(events: WorldEvent[], world: World): void {
    for (const e of events) {
      if (e.kind === 'splash') this.splashes.push({ x: e.at.x, y: e.at.y, age: 0 });
      if (e.kind === 'throw') this.throwAnims.set(e.slot, { until: this.t + 0.55 });
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
          vx: Math.cos(ang) * 220, vy: Math.sin(ang) * 220 - 260,
          age: 0,
        });
      }
      if (e.kind === 'blink') {
        for (const spot of [e.from, e.to]) {
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            this.spray.push({ x: spot.x, y: spot.y, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130, age: 0, color: '#bfe9ff' });
          }
        }
      }
      if (e.kind === 'ricochet') {
        const p = world.penguins.find((q) => q.slot === e.slot);
        if (p) this.shockwaves.push({ x: p.pos.x, y: p.pos.y, age: 0.35 });
      }
      if (e.kind === 'bounce') {
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          this.spray.push({ x: e.at.x, y: e.at.y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, age: 0 });
        }
      }
    }
  }

  draw(w: World, dtMs: number): void {
    this.t += dtMs / 1000;
    this.initForFloe(w.floe);
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    const c = this.ctx;
    c.imageSmoothingEnabled = false;

    const scale = Math.min(this.canvas.width / ARENA_W, this.canvas.height / ARENA_H);
    c.fillStyle = '#47aba9'; // pack's sea color for the letterbox
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.save();
    c.translate((this.canvas.width - ARENA_W * scale) / 2, (this.canvas.height - ARENA_H * scale) / 2);
    c.scale(scale, scale);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dtMs / 400);
      const amp = this.shake * 14;
      c.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }

    this.waterLayer(c);
    this.foamLayer(c);
    this.islandLayer(c, w.floe);
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
  }

  private waterLayer(c: CanvasRenderingContext2D): void {
    if (this.waterPattern) {
      c.fillStyle = this.waterPattern;
      c.fillRect(0, 0, ARENA_W, ARENA_H);
    }
    // a few bobbing rocks in open water
    const rockFrame = Math.floor(this.t * 8) % 8;
    for (const [img, x, y] of [
      [this.a.img.rocks1, 120, 140],
      [this.a.img.rocks2, ARENA_W - 220, 220],
      [this.a.img.rocks1, ARENA_W - 180, ARENA_H - 190],
      [this.a.img.rocks2, 90, ARENA_H - 160],
    ] as const) {
      c.drawImage(img, rockFrame * 128, 0, 128, 128, x, y, 128, 128);
    }
  }

  private foamLayer(c: CanvasRenderingContext2D): void {
    const frame = Math.floor(this.t * 9) % 8;
    for (const p of this.foamSpots) {
      c.drawImage(this.a.img.foam, frame * 192, 0, 192, 192, p.x - 96, p.y - 96, 192, 192);
    }
  }

  private islandLayer(c: CanvasRenderingContext2D, f: Floe): void {
    if (!this.islandCache || this.islandCache.holes !== f.holes.length) {
      const canvas = this.islandCache?.canvas ?? document.createElement('canvas');
      canvas.width = ARENA_W;
      canvas.height = ARENA_H;
      const ic = canvas.getContext('2d')!;
      ic.clearRect(0, 0, ARENA_W, ARENA_H);
      const path = new Path2D();
      for (let i = 0; i < f.radii.length; i++) {
        const a = spokeAngle(i);
        const x = f.cx + Math.cos(a) * f.radii[i] * f.sx;
        const y = f.cy + Math.sin(a) * f.radii[i];
        i === 0 ? path.moveTo(x, y) : path.lineTo(x, y);
      }
      path.closePath();
      // sand lip under the grass, then grass pattern
      ic.save();
      ic.translate(0, 10);
      ic.fillStyle = '#d8b365';
      ic.fill(path);
      ic.restore();
      ic.fillStyle = this.groundPattern ?? '#7ec850';
      ic.fill(path);
      ic.lineWidth = 6;
      ic.strokeStyle = 'rgba(255, 250, 220, .5)';
      ic.stroke(path);
      // punch the blast holes out to water
      for (const h of f.holes) {
        ic.save();
        ic.globalCompositeOperation = 'destination-out';
        ic.beginPath();
        ic.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ic.fill();
        ic.restore();
        // scorched lip
        ic.beginPath();
        ic.arc(h.x, h.y, h.r + 3, 0, Math.PI * 2);
        ic.lineWidth = 6;
        ic.strokeStyle = 'rgba(90, 60, 30, .55)';
        ic.stroke();
      }
      this.islandCache = { canvas, holes: f.holes.length };
    }
    c.drawImage(this.islandCache.canvas, 0, 0);
  }

  private decoLayer(c: CanvasRenderingContext2D): void {
    for (const d of this.decoSpots) {
      c.drawImage(this.a.img[d.img], d.x - 32, d.y - 40, 64, 64);
    }
  }

  private actorsLayer(c: CanvasRenderingContext2D, w: World, dtMs: number): void {
    type Actor = { y: number; drawFn: () => void };
    const actors: Actor[] = [];

    for (const p of w.penguins) {
      if (!p.alive) continue;
      actors.push({ y: p.pos.y, drawFn: () => this.goblin(c, p) });
    }

    // pickups bob gently
    for (const pk of w.pickups) {
      const bob = Math.sin(this.t * 3 + pk.id) * 4;
      actors.push({
        y: pk.pos.y,
        drawFn: () => {
          c.save();
          c.translate(pk.pos.x, pk.pos.y + bob);
          c.beginPath();
          c.ellipse(0, 16 - bob, 18, 7, 0, 0, Math.PI * 2);
          c.fillStyle = 'rgba(40, 70, 40, .3)';
          c.fill();
          if (pk.kind === 'heart') this.heart(c, 0, 0, 15, '#ff4560');
          else this.crate(c, 0, 0);
          c.restore();
        },
      });
    }

    // the sheep: pure ambience, wanders the island
    this.stepSheep(w, dtMs);
    actors.push({
      y: this.sheep.y,
      drawFn: () => {
        const moving = Math.hypot(this.sheep.vx, this.sheep.vy) > 6;
        const frame = moving ? Math.floor(this.t * 10) % 6 : 0;
        c.save();
        c.translate(this.sheep.x, this.sheep.y);
        if (this.sheep.vx < 0) c.scale(-1, 1);
        c.drawImage(this.a.img.sheep, frame * 128, 0, 128, 128, -48, -64, 96, 96);
        c.restore();
      },
    });

    // blast victims tumbling through the air
    for (const tb of [...this.tumbles]) {
      tb.age += dtMs / 1000;
      tb.x += tb.vx * dtMs / 1000;
      tb.y += tb.vy * dtMs / 1000;
      tb.vy += 700 * dtMs / 1000;
      if (tb.age > 1.1) {
        this.tumbles = this.tumbles.filter((q) => q !== tb);
        continue;
      }
      actors.push({
        y: tb.y + 4000, // always on top
        drawFn: () => {
          c.save();
          c.translate(tb.x, tb.y);
          c.rotate(tb.age * 12);
          c.globalAlpha = Math.min(1, 2.2 - tb.age * 2);
          const sheet = this.a.goblins[tb.slot % this.a.goblins.length];
          c.drawImage(sheet, 0, 0, GOBLIN.FW, GOBLIN.FH, -45, -45, 90, 90);
          c.restore();
          c.globalAlpha = 1;
        },
      });
    }

    actors.sort((x, z) => x.y - z.y);
    for (const a of actors) a.drawFn();
  }

  private goblin(c: CanvasRenderingContext2D, p: Penguin): void {
    const R = TUNE.PENGUIN_RADIUS;
    const size = R * 6; // frame draw size; the goblin fills ~1/3 of the frame
    const sheet = this.a.goblins[p.slot % this.a.goblins.length];
    const speed = Math.hypot(p.vel.x, p.vel.y);

    if (Math.abs(p.vel.x) > 12) this.facing.set(p.slot, Math.sign(p.vel.x));
    const face = this.facing.get(p.slot) ?? 1;

    // invulnerable = flashing
    if (p.invulnMs > 0 && Math.floor((INVULN_MS - p.invulnMs) / 110) % 2 === 0) return;

    const throwing = this.throwAnims.get(p.slot);
    let row = 0;
    let frames = GOBLIN.IDLE;
    let rate = 7;
    if (throwing && this.t < throwing.until) {
      row = 2;
      frames = GOBLIN.THROW;
      rate = 13;
    } else if (speed > 25) {
      row = 1;
      frames = GOBLIN.RUN;
      rate = 11;
    }
    const frame = Math.floor(this.t * rate) % frames;

    c.drawImage(this.a.img.shadow, p.pos.x - size / 2, p.pos.y - size / 2 + 6, size, size);
    c.save();
    c.translate(p.pos.x, p.pos.y);
    if (face < 0) c.scale(-1, 1);
    c.drawImage(sheet, frame * GOBLIN.FW, row * GOBLIN.FH, GOBLIN.FW, GOBLIN.FH, -size / 2, -size / 2 - R, size, size);
    c.restore();

    // shield bubble
    if (p.shieldMs > 0) {
      c.save();
      c.globalAlpha = 0.35 + Math.sin(this.t * 10) * 0.08;
      c.fillStyle = '#9fdcff';
      c.strokeStyle = '#e8f8ff';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(p.pos.x, p.pos.y - R, R * 2.4, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }

    // name chip + hearts
    c.font = 'bold 15px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    const tw = c.measureText(p.name).width;
    c.fillStyle = 'rgba(8, 16, 34, .55)';
    c.beginPath();
    c.roundRect(p.pos.x - tw / 2 - 7, p.pos.y - R - size / 2 - 6, tw + 14, 20, 6);
    c.fill();
    c.fillStyle = p.color;
    c.fillText(p.name, p.pos.x, p.pos.y - R - size / 2 + 9);
    for (let i = 0; i < p.lives; i++) {
      this.heart(c, p.pos.x + (i - (p.lives - 1) / 2) * 16, p.pos.y - R - size / 2 - 16, 6, '#ff4560');
    }
  }

  private stepSheep(w: World, dtMs: number): void {
    const s = this.sheep;
    s.timer -= dtMs;
    if (s.timer <= 0) {
      s.timer = 1200 + Math.random() * 2600;
      s.dir = Math.random() * Math.PI * 2;
      const still = Math.random() < 0.4;
      s.vx = still ? 0 : Math.cos(s.dir) * 55;
      s.vy = still ? 0 : Math.sin(s.dir) * 55;
    }
    const nx = s.x + s.vx * dtMs / 1000;
    const ny = s.y + s.vy * dtMs / 1000;
    if (contains(w.floe, { x: nx, y: ny })) {
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

  private crate(c: CanvasRenderingContext2D, x: number, y: number): void {
    c.save();
    c.translate(x, y);
    c.fillStyle = '#a5692e';
    c.strokeStyle = '#6e421a';
    c.lineWidth = 3;
    c.fillRect(-16, -16, 32, 32);
    c.strokeRect(-16, -16, 32, 32);
    c.beginPath();
    c.moveTo(-16, -16); c.lineTo(16, 16);
    c.moveTo(16, -16); c.lineTo(-16, 16);
    c.stroke();
    c.fillStyle = '#ffe9b0';
    c.font = 'bold 18px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.fillText('?', 0, 7);
    c.restore();
  }

  private dynamite(c: CanvasRenderingContext2D, x: number, y: number, scale: number, frac: number): void {
    const frame = Math.floor(this.t * (6 + frac * 14)) % 6;
    const s = 64 * scale;
    if (frac > 0.6) {
      c.save();
      c.globalAlpha = 0.3 + (frac - 0.6) * 1.2;
      c.shadowColor = '#ff3b30';
      c.shadowBlur = 26;
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
      const sy = target.pos.y - 120 - (1 - t) * 520;
      c.font = 'bold 44px "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#ff5a5f';
      c.fillText('!', target.pos.x, target.pos.y - 88 - Math.abs(Math.sin(this.t * 8)) * 10);
      this.dynamite(c, target.pos.x, sy, 1.4, 0); // falling from the sky
      return;
    }

    if (b.s === 'carried') {
      const me = w.penguins.find((p) => p.slot === b.slot);
      if (!me) return;
      c.save();
      c.translate(me.pos.x, me.pos.y);
      c.rotate(this.t * 0.7);
      c.setLineDash([26, 18]);
      c.lineWidth = 5;
      c.strokeStyle = `rgba(255, ${Math.round(120 - frac * 90)}, 90, ${0.5 + frac * 0.4})`;
      c.beginPath();
      c.arc(0, 0, BOMB.PASS_RADIUS, 0, Math.PI * 2);
      c.stroke();
      c.restore();
      this.dynamite(c, me.pos.x, me.pos.y - TUNE.PENGUIN_RADIUS * 4.2, 1, frac);
      return;
    }

    if (b.s === 'flying') {
      const x = b.from.x + (b.to.x - b.from.x) * b.t01;
      const y = b.from.y + (b.to.y - b.from.y) * b.t01;
      const h = Math.sin(Math.PI * Math.min(b.t01, 1)) * 150;
      c.save();
      c.setLineDash([8, 8]);
      c.lineWidth = 4;
      c.strokeStyle = b.dodged ? 'rgba(200, 215, 230, .7)' : 'rgba(255, 90, 95, .85)';
      c.beginPath();
      c.arc(b.to.x, b.to.y, 46 * (1.4 - 0.4 * b.t01), 0, Math.PI * 2);
      c.stroke();
      c.restore();
      c.beginPath();
      c.ellipse(x, y, 16 - h * 0.05, 8 - h * 0.02, 0, 0, Math.PI * 2);
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
        const s = 192 * 1.6;
        c.drawImage(this.a.img.explosions, frame * 192, 0, 192, 192, boom.x - s / 2, boom.y - s / 2, s, s);
      }
    }
    this.booms = this.booms.filter((b) => b.age * 18 < 9);
  }

  private updateSplashes(c: CanvasRenderingContext2D, dtMs: number): void {
    for (const s of this.splashes) {
      s.age += dtMs / 1000;
      for (const mult of [1, 0.6]) {
        const r = (14 + s.age * 120) * mult;
        c.beginPath();
        c.arc(s.x, s.y, r, 0, Math.PI * 2);
        c.lineWidth = Math.max(7 - s.age * 6, 1) * mult;
        c.strokeStyle = `rgba(235, 250, 255, ${Math.max(0.85 - s.age, 0)})`;
        c.stroke();
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < 1.1);
  }

  private updateShockwaves(c: CanvasRenderingContext2D, dtMs: number): void {
    for (const s of this.shockwaves) {
      s.age += dtMs / 1000;
      const r = s.age * 640;
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.lineWidth = Math.max(14 - s.age * 24, 2);
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
      c.arc(s.x, s.y, s.color ? 4.5 : 3.2, 0, Math.PI * 2);
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
