// Arena renderer: everything procedural on Canvas 2D. Press P to toggle retro
// mode â€” the same scene rendered at low resolution and upscaled with
// smoothing off, i.e. free pixel art.
//
// Scene layers, back to front: night sky (stars, moon) â†’ aurora curtains â†’
// distant icebergs + the Arctic Mart neon â†’ water (waves, aurora shimmer) â†’
// floe (submerged rim, foam ring, surface, speckle texture) â†’ splashes and
// bobbing ice cubes â†’ penguins (shadow, trolley, bird, scarf) with snow spray
// and motion trails â†’ vignette.

import { BOMB, fuseFrac } from '../sim/bomb';
import { ARENA_H, ARENA_W, TUNE } from '../sim/constants';
import { spokeAngle, radiusAt, type Floe } from '../sim/floe';
import type { Penguin, World, WorldEvent } from '../sim/world';

type Splash = { x: number; y: number; age: number };
type Cube = { x: number; y: number; born: number; color: string };
type Spray = { x: number; y: number; vx: number; vy: number; age: number; color?: string };
type Shockwave = { x: number; y: number; age: number };

const rand = (seed: number) => {
  // deterministic decorations: mulberry32
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private low: HTMLCanvasElement;
  private lowCtx: CanvasRenderingContext2D;
  retro = false;
  private splashes: Splash[] = [];
  private cubes: Cube[] = [];
  private spray: Spray[] = [];
  private shockwaves: Shockwave[] = [];
  private shake = 0;
  private flash = 0;
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  private speckles: { a: number; d: number; r: number }[] = []; // polar, relative
  private t = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.low = document.createElement('canvas');
    this.low.width = ARENA_W / 5;
    this.low.height = ARENA_H / 5;
    this.lowCtx = this.low.getContext('2d')!;
    const r1 = rand(1234);
    for (let i = 0; i < 90; i++) {
      this.stars.push({ x: r1() * ARENA_W, y: r1() * ARENA_H * 0.30, r: 0.6 + r1() * 1.6, tw: r1() * 6 });
    }
    const r2 = rand(777);
    for (let i = 0; i < 110; i++) {
      this.speckles.push({ a: r2() * Math.PI * 2, d: Math.sqrt(r2()), r: 1 + r2() * 3.4 });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'p') this.retro = !this.retro;
    });
  }

  addEvents(events: WorldEvent[], world: World): void {
    for (const e of events) {
      if (e.kind === 'splash') {
        this.splashes.push({ x: e.at.x, y: e.at.y, age: 0 });
        const p = world.penguins.find((q) => q.slot === e.slot);
        this.cubes.push({ x: e.at.x, y: e.at.y, born: this.t, color: p?.color ?? '#fff' });
      }
      if (e.kind === 'explode') {
        this.shake = 1;
        this.flash = 0.35;
        this.shockwaves.push({ x: e.at.x, y: e.at.y, age: 0 });
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * Math.PI * 2;
          const v = 180 + Math.random() * 260;
          this.spray.push({
            x: e.at.x, y: e.at.y,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v,
            age: -0.1,
            color: i % 3 === 0 ? '#ffb400' : i % 3 === 1 ? '#ff6a3d' : '#ffffff',
          });
        }
      }
      if (e.kind === 'bounce') {
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          this.spray.push({ x: e.at.x, y: e.at.y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, age: 0 });
        }
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
        if (p) this.shockwaves.push({ x: p.pos.x, y: p.pos.y, age: 0.35 }); // small, quick ring
      }
      if (e.kind === 'launched') {
        // blasted skyward: their cube splashes down a beat later, further out
        const p = world.penguins.find((q) => q.slot === e.slot);
        this.cubes.push({
          x: e.at.x + (Math.random() - 0.5) * 260,
          y: e.at.y + (Math.random() - 0.5) * 260,
          born: this.t + 0.9,
          color: p?.color ?? '#fff',
        });
      }
    }
  }

  draw(w: World, dtMs: number): void {
    this.t += dtMs / 1000;
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;

    this.ctx.fillStyle = '#052430'; // letterbox = same deep water as the scene edge
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const target = this.retro ? this.lowCtx : this.ctx;
    const scale = this.retro
      ? this.low.width / ARENA_W
      : Math.min(this.canvas.width / ARENA_W, this.canvas.height / ARENA_H);

    target.save();
    if (!this.retro) {
      target.translate(
        (this.canvas.width - ARENA_W * scale) / 2,
        (this.canvas.height - ARENA_H * scale) / 2,
      );
    }
    target.scale(scale, scale);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dtMs / 400);
      const amp = this.shake * 16;
      target.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }
    this.scene(target, w, dtMs);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dtMs / 1000);
      target.fillStyle = `rgba(255, 240, 220, ${this.flash * 2})`;
      target.fillRect(0, 0, ARENA_W, ARENA_H);
    }
    target.restore();

    if (this.retro) {
      this.ctx.imageSmoothingEnabled = false;
      const s = Math.min(this.canvas.width / this.low.width, this.canvas.height / this.low.height);
      this.ctx.drawImage(
        this.low,
        (this.canvas.width - this.low.width * s) / 2,
        (this.canvas.height - this.low.height * s) / 2,
        this.low.width * s,
        this.low.height * s,
      );
    }
  }

  private scene(c: CanvasRenderingContext2D, w: World, dtMs: number): void {
    this.water(c);
    this.floe(c, w.floe);
    this.updateSplashes(c, dtMs);
    this.updateCubes(c);
    this.emitSpray(w);
    this.updateSpray(c, dtMs);
    const sorted = [...w.penguins].filter((p) => p.alive).sort((a, b) => a.pos.y - b.pos.y);
    for (const p of sorted) this.penguin(c, p);
    this.bombLayer(c, w);
    this.updateShockwaves(c, dtMs);
    this.vignette(c);
  }

  private bombLayer(c: CanvasRenderingContext2D, w: World): void {
    const b = w.bomb;
    const frac = fuseFrac(b);

    if (b.s === 'delivering') {
      const target = w.penguins.find((p) => p.slot === b.toSlot);
      if (!target) return;
      const t = Math.min(b.t / BOMB.SKUA_MS, 1);
      const sx = target.pos.x + (1 - t) * 320;
      const sy = target.pos.y - 90 - (1 - t) * 420;
      // exclamation over the chosen one
      c.font = 'bold 44px "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#ff5a5f';
      c.fillText('!', target.pos.x, target.pos.y - 58 - Math.abs(Math.sin(this.t * 8)) * 10);
      this.skua(c, sx, sy);
      this.bombSprite(c, sx + 6, sy + 34, 0.8, 0);
      return;
    }

    if (b.s === 'carried') {
      const me = w.penguins.find((p) => p.slot === b.slot);
      if (!me) return;
      // pass radius ring, rotating dashes, angrier as fuse burns
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
      const pulse = 1 + Math.sin(this.t * (4 + frac * 14)) * 0.08 * (0.5 + frac);
      this.bombSprite(c, me.pos.x, me.pos.y - TUNE.PENGUIN_RADIUS * 1.6, pulse, frac);
      return;
    }

    if (b.s === 'flying') {
      const x = b.from.x + (b.to.x - b.from.x) * b.t01;
      const y = b.from.y + (b.to.y - b.from.y) * b.t01;
      const h = Math.sin(Math.PI * Math.min(b.t01, 1)) * 130;
      // landing reticle â€” the dodge telegraph
      c.save();
      c.setLineDash([8, 8]);
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(255, 90, 95, .85)';
      c.beginPath();
      c.arc(b.to.x, b.to.y, BOMB.STICK_RADIUS * (1.4 - 0.4 * b.t01), 0, Math.PI * 2);
      c.stroke();
      c.restore();
      // shadow shrinks with height
      c.beginPath();
      c.ellipse(x, y, 18 - h * 0.06, 9 - h * 0.03, 0, 0, Math.PI * 2);
      c.fillStyle = 'rgba(20, 40, 70, .4)';
      c.fill();
      this.bombSprite(c, x, y - h, 1, fuseFrac(b));
      return;
    }

    if (b.s === 'ground') {
      // danger circle breathes faster near the end
      c.save();
      c.globalAlpha = 0.16 + Math.abs(Math.sin(this.t * (2 + frac * 10))) * 0.12;
      c.fillStyle = '#ff5a5f';
      c.beginPath();
      c.arc(b.pos.x, b.pos.y, BOMB.BLAST_RADIUS, 0, Math.PI * 2);
      c.fill();
      c.restore();
      this.bombSprite(c, b.pos.x, b.pos.y, 1, frac);
    }
  }

  private skua(c: CanvasRenderingContext2D, x: number, y: number): void {
    c.save();
    c.translate(x, y);
    const flap = Math.sin(this.t * 16) * 0.9;
    c.fillStyle = '#dfe9f2';
    for (const side of [-1, 1]) {
      c.save();
      c.rotate(side * flap * 0.5);
      c.beginPath();
      c.ellipse(side * 26, -6, 26, 9, side * 0.5, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    c.beginPath();
    c.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffb400';
    c.beginPath();
    c.moveTo(14, -2);
    c.lineTo(26, 2);
    c.lineTo(14, 5);
    c.closePath();
    c.fill();
    c.restore();
  }

  private bombSprite(c: CanvasRenderingContext2D, x: number, y: number, scale: number, frac: number): void {
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    // red glow rises with the fuse
    if (frac > 0) {
      c.save();
      c.globalAlpha = 0.25 + frac * 0.45;
      c.shadowColor = '#ff3b30';
      c.shadowBlur = 24 + frac * 30;
      c.fillStyle = '#ff3b30';
      c.beginPath();
      c.arc(0, 0, 17, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    c.beginPath();
    c.arc(0, 0, 17, 0, Math.PI * 2);
    c.fillStyle = '#171c24';
    c.fill();
    c.beginPath();
    c.arc(-5, -6, 5, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,.28)';
    c.fill();
    // fuse: shortens as it burns, spark at the tip
    const fuseLen = 14 * (1 - frac * 0.8);
    c.strokeStyle = '#c9a66b';
    c.lineWidth = 3.5;
    c.beginPath();
    c.moveTo(4, -15);
    c.quadraticCurveTo(10, -20 - fuseLen * 0.4, 4 + fuseLen * 0.6, -18 - fuseLen);
    c.stroke();
    const sx = 4 + fuseLen * 0.6;
    const sy = -18 - fuseLen;
    c.fillStyle = Math.sin(this.t * 30) > 0 ? '#ffe08a' : '#ff9d3d';
    c.beginPath();
    c.arc(sx, sy, 4.5 + Math.random() * 2, 0, Math.PI * 2);
    c.fill();
    c.restore();
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

  /**
   * Full top-down ocean: deep water fills the whole frame, and the aurora
   * exists only as drifting color washes reflected on the surface. No sky,
   * no horizon — we are looking straight down at a floe at night.
   */
  private water(c: CanvasRenderingContext2D): void {
    const g = c.createRadialGradient(
      ARENA_W / 2, ARENA_H / 2, ARENA_H * 0.25,
      ARENA_W / 2, ARENA_H / 2, ARENA_W * 0.62,
    );
    g.addColorStop(0, '#0f4d60');
    g.addColorStop(0.6, '#0a3a4d');
    g.addColorStop(1, '#052430');
    c.fillStyle = g;
    c.fillRect(0, 0, ARENA_W, ARENA_H);

    // aurora reflections: big soft color washes sliding over the water
    c.save();
    c.globalCompositeOperation = 'lighter';
    const washes = [
      { hue: 150, cx: 0.25, cy: 0.2, r: 500, speed: 0.11, alpha: 0.05 },
      { hue: 285, cx: 0.78, cy: 0.3, r: 560, speed: 0.07, alpha: 0.045 },
      { hue: 175, cx: 0.5, cy: 0.85, r: 520, speed: 0.09, alpha: 0.04 },
      { hue: 320, cx: 0.12, cy: 0.75, r: 430, speed: 0.13, alpha: 0.035 },
    ];
    for (const wsh of washes) {
      const x = wsh.cx * ARENA_W + Math.sin(this.t * wsh.speed * 2) * 130;
      const y = wsh.cy * ARENA_H + Math.cos(this.t * wsh.speed * 1.4) * 90;
      const grad = c.createRadialGradient(x, y, 0, x, y, wsh.r);
      grad.addColorStop(0, `hsla(${wsh.hue}, 90%, 65%, ${wsh.alpha})`);
      grad.addColorStop(1, 'transparent');
      c.fillStyle = grad;
      c.fillRect(x - wsh.r, y - wsh.r, wsh.r * 2, wsh.r * 2);
    }
    c.restore();

    // gentle wave strokes drifting across the whole surface
    c.save();
    for (let i = 0; i < 16; i++) {
      const y = (i / 16) * ARENA_H + Math.sin(this.t * 0.5 + i * 1.7) * 14;
      c.globalAlpha = 0.045 + (i % 3) * 0.012;
      c.strokeStyle = i % 4 === 0 ? '#7dffb2' : i % 4 === 2 ? '#d98cff' : '#bfe9ff';
      c.lineWidth = 2.2;
      c.beginPath();
      for (let x = -60; x <= ARENA_W + 60; x += 64) {
        const wy = y + Math.sin(x * 0.014 + this.t * 1.1 + i * 2) * 6;
        x === -60 ? c.moveTo(x, wy) : c.lineTo(x, wy);
      }
      c.stroke();
    }
    c.restore();

    // star glints twinkling on the water
    for (const s of this.stars) {
      c.globalAlpha = 0.12 + 0.2 * Math.abs(Math.sin(this.t * 0.8 + s.tw));
      c.fillStyle = '#dceaff';
      c.fillRect(s.x, (s.y * 3.2) % ARENA_H, s.r, s.r);
    }
    c.globalAlpha = 1;
  }

  private floePath(c: CanvasRenderingContext2D, f: Floe, inset: number, wobblePhase = 0): void {
    c.beginPath();
    for (let i = 0; i < f.radii.length; i++) {
      const a = spokeAngle(i);
      const wob = wobblePhase ? Math.sin(a * 5 + this.t * 2) * 3 : 0;
      const r = Math.max(f.radii[i] - inset + wob, 0);
      const x = f.cx + Math.cos(a) * r * f.sx;
      const y = f.cy + Math.sin(a) * r;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.closePath();
  }

  private floe(c: CanvasRenderingContext2D, f: Floe): void {
    // lapping foam ring
    c.save();
    this.floePath(c, f, -14, 1);
    c.fillStyle = 'rgba(214, 240, 252, .22)';
    c.fill();
    c.restore();
    // submerged blue rim, offset down
    c.save();
    c.translate(0, 12);
    this.floePath(c, f, 0);
    c.fillStyle = '#4f88b5';
    c.fill();
    c.restore();
    // surface
    this.floePath(c, f, 0);
    const g = c.createRadialGradient(f.cx - 120, f.cy - 160, 60, f.cx, f.cy, TUNE.FLOE_RADIUS * f.sx * 1.15);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#eef6fc');
    g.addColorStop(1, '#cfe3f2');
    c.fillStyle = g;
    c.fill();
    this.floePath(c, f, 0);
    c.lineWidth = 4;
    c.strokeStyle = '#aecfe6';
    c.stroke();
    // texture: speckles and faint veins, clipped to the surface
    c.save();
    this.floePath(c, f, 6);
    c.clip();
    c.fillStyle = 'rgba(140, 180, 210, .35)';
    for (const s of this.speckles) {
      const rr = radiusAt(f, s.a) * s.d * 0.92;
      c.beginPath();
      c.arc(f.cx + Math.cos(s.a) * rr * f.sx, f.cy + Math.sin(s.a) * rr, s.r, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = 'rgba(160, 200, 225, .3)';
    c.lineWidth = 2;
    for (let v = 0; v < 5; v++) {
      const a0 = (v / 5) * Math.PI * 2 + 0.7;
      c.beginPath();
      c.moveTo(f.cx + Math.cos(a0) * 40, f.cy + Math.sin(a0) * 40);
      c.quadraticCurveTo(
        f.cx + Math.cos(a0 + 0.5) * 190,
        f.cy + Math.sin(a0 + 0.5) * 190,
        f.cx + Math.cos(a0 + 0.3) * 330,
        f.cy + Math.sin(a0 + 0.3) * 330,
      );
      c.stroke();
    }
    c.restore();
  }

  private updateSplashes(c: CanvasRenderingContext2D, dtMs: number): void {
    for (const s of this.splashes) {
      s.age += dtMs / 1000;
      for (const mult of [1, 0.6]) {
        const r = (14 + s.age * 120) * mult;
        c.beginPath();
        c.arc(s.x, s.y, r, 0, Math.PI * 2);
        c.lineWidth = Math.max(7 - s.age * 6, 1) * mult;
        c.strokeStyle = `rgba(225, 248, 255, ${Math.max(0.85 - s.age, 0)})`;
        c.stroke();
      }
      // droplets
      c.fillStyle = `rgba(225, 248, 255, ${Math.max(0.9 - s.age * 1.2, 0)})`;
      for (let d = 0; d < 7; d++) {
        const a = (d / 7) * Math.PI * 2;
        const rr = 20 + s.age * 190;
        c.beginPath();
        c.arc(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr - s.age * 60 + s.age * s.age * 160, 4, 0, Math.PI * 2);
        c.fill();
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < 1.1);
  }

  /** Eliminated penguins bob past frozen in an ice cube â€” the spec's promise. */
  private updateCubes(c: CanvasRenderingContext2D): void {
    for (const cube of this.cubes) {
      const age = this.t - cube.born;
      if (age < 0.6) continue; // wait for the splash to clear
      const x = cube.x + Math.sin(this.t * 0.6 + cube.born) * 30 + age * 12;
      const y = cube.y + Math.sin(this.t * 1.1 + cube.born * 2) * 6;
      c.save();
      c.translate(x, y);
      c.rotate(Math.sin(this.t * 0.8 + cube.born) * 0.12);
      c.globalAlpha = 0.85;
      c.fillStyle = 'rgba(190, 226, 248, .8)';
      c.strokeStyle = '#e8f6ff';
      c.lineWidth = 3;
      const S = 30;
      c.fillRect(-S, -S, S * 2, S * 2);
      c.strokeRect(-S, -S, S * 2, S * 2);
      // tiny penguin inside
      c.beginPath();
      c.ellipse(0, 2, 12, 15, 0, 0, Math.PI * 2);
      c.fillStyle = '#1c2733';
      c.fill();
      c.beginPath();
      c.ellipse(0, 5, 7, 9, 0, 0, Math.PI * 2);
      c.fillStyle = '#f4f8fb';
      c.fill();
      c.fillStyle = cube.color;
      c.fillRect(-8, -6, 16, 5);
      c.restore();
      c.globalAlpha = 1;
    }
    this.cubes = this.cubes.filter((k) => this.t - k.born < 30);
  }

  private emitSpray(w: World): void {
    for (const p of w.penguins) {
      if (!p.alive || Math.abs(p.steer) < 0.55) continue;
      const back = p.heading + Math.PI;
      this.spray.push({
        x: p.pos.x + Math.cos(back) * TUNE.PENGUIN_RADIUS * 1.4,
        y: p.pos.y + Math.sin(back) * TUNE.PENGUIN_RADIUS * 1.4,
        vx: Math.cos(back + (Math.random() - 0.5)) * 90,
        vy: Math.sin(back + (Math.random() - 0.5)) * 90,
        age: 0,
      });
    }
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

  private penguin(c: CanvasRenderingContext2D, p: Penguin): void {
    const R = TUNE.PENGUIN_RADIUS;
    const { x, y } = p.pos;
    const waddle = Math.sin(this.t * 9 + p.slot * 3) * 0.06;

    // motion streak
    const speed = Math.hypot(p.vel.x, p.vel.y);
    if (speed > 40) {
      c.save();
      c.strokeStyle = `${p.color}44`;
      c.lineWidth = R * 1.1;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x - p.vel.x * 0.14, y - p.vel.y * 0.14);
      c.lineTo(x, y);
      c.stroke();
      c.restore();
    }

    c.save();
    c.translate(x, y);
    c.beginPath();
    c.ellipse(0, R * 0.85, R * 1.35, R * 0.5, 0, 0, Math.PI * 2);
    c.fillStyle = 'rgba(40, 70, 100, .3)';
    c.fill();
    c.rotate(p.heading + waddle);

    // trolley: basket with mesh lines + four wheels + handlebar
    c.fillStyle = '#b8cad9';
    c.strokeStyle = '#8298ac';
    c.lineWidth = 2.5;
    c.fillRect(-R * 1.25, -R * 0.95, R * 2.5, R * 1.9);
    c.strokeRect(-R * 1.25, -R * 0.95, R * 2.5, R * 1.9);
    c.strokeStyle = 'rgba(130, 152, 172, .5)';
    c.lineWidth = 1.4;
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.moveTo(i * R * 0.45, -R * 0.95);
      c.lineTo(i * R * 0.45, R * 0.95);
      c.stroke();
    }
    c.fillStyle = '#31404f';
    for (const [wx, wy] of [[-R * 1.05, -R * 1.05], [-R * 1.05, R * 1.05], [R * 1.05, -R * 1.05], [R * 1.05, R * 1.05]] as const) {
      c.beginPath();
      c.arc(wx, wy, R * 0.26, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#d5e2ec';
    c.fillRect(-R * 1.6, -R * 0.95, R * 0.32, R * 1.9);

    // bird: body, belly, head, eyes, beak, flippers
    c.beginPath();
    c.ellipse(-R * 0.1, 0, R * 1.0, R * 0.8, 0, 0, Math.PI * 2);
    c.fillStyle = '#232f3d';
    c.fill();
    c.beginPath();
    c.ellipse(R * 0.05, 0, R * 0.6, R * 0.5, 0, 0, Math.PI * 2);
    c.fillStyle = '#f6fafc';
    c.fill();
    // flippers trail slightly opposite to steer
    for (const side of [-1, 1]) {
      c.save();
      c.rotate(side * (0.5 + p.steer * side * 0.25));
      c.beginPath();
      c.ellipse(-R * 0.5, side * R * 0.62, R * 0.42, R * 0.18, 0, 0, Math.PI * 2);
      c.fillStyle = '#1a242f';
      c.fill();
      c.restore();
    }
    // head
    c.beginPath();
    c.arc(R * 0.62, 0, R * 0.5, 0, Math.PI * 2);
    c.fillStyle = '#232f3d';
    c.fill();
    for (const side of [-1, 1]) {
      c.beginPath();
      c.arc(R * 0.78, side * R * 0.2, R * 0.13, 0, Math.PI * 2);
      c.fillStyle = '#ffffff';
      c.fill();
      c.beginPath();
      c.arc(R * 0.82, side * R * 0.2, R * 0.06, 0, Math.PI * 2);
      c.fillStyle = '#10161d';
      c.fill();
    }
    c.beginPath();
    c.moveTo(R * 1.05, -R * 0.14);
    c.lineTo(R * 1.5, 0);
    c.lineTo(R * 1.05, R * 0.14);
    c.closePath();
    c.fillStyle = '#ffb400';
    c.fill();
    // scarf + tail flapping backwards
    c.fillStyle = p.color;
    c.beginPath();
    c.ellipse(R * 0.28, 0, R * 0.34, R * 0.42, 0, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.rotate(Math.sin(this.t * 7 + p.slot) * 0.15);
    c.fillRect(-R * 1.15, -R * 0.16, R * 0.8, R * 0.32);
    c.restore();
    c.restore();

    // ice shield bubble
    if (p.shieldMs > 0) {
      c.save();
      c.globalAlpha = 0.32 + Math.sin(this.t * 10) * 0.08;
      c.fillStyle = '#9fdcff';
      c.strokeStyle = '#e8f8ff';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x, y, R * 1.9, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }

    // name chip (unrotated)
    c.font = `bold ${Math.round(R * 0.72)}px "Segoe UI", sans-serif`;
    c.textAlign = 'center';
    const label = p.name;
    const tw = c.measureText(label).width;
    c.fillStyle = 'rgba(8, 16, 34, .55)';
    const pad = 7;
    c.beginPath();
    c.roundRect(x - tw / 2 - pad, y - R * 2.5, tw + pad * 2, R * 0.95, 6);
    c.fill();
    c.fillStyle = p.color;
    c.fillText(label, x, y - R * 1.82);
  }

  private vignette(c: CanvasRenderingContext2D): void {
    const g = c.createRadialGradient(
      ARENA_W / 2, ARENA_H / 2, ARENA_H * 0.45,
      ARENA_W / 2, ARENA_H / 2, ARENA_H * 0.95,
    );
    g.addColorStop(0, 'transparent');
    g.addColorStop(1, 'rgba(3, 6, 18, .55)');
    c.fillStyle = g;
    c.fillRect(0, 0, ARENA_W, ARENA_H);
  }
}
