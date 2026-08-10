// Arena renderer: everything procedural on Canvas 2D. Press P to toggle retro
// mode — the same scene rendered at low resolution and upscaled with
// smoothing off, i.e. free pixel art.
//
// Scene layers, back to front: night sky (stars, moon) → aurora curtains →
// distant icebergs + the Arctic Mart neon → water (waves, aurora shimmer) →
// floe (submerged rim, foam ring, surface, speckle texture) → splashes and
// bobbing ice cubes → penguins (shadow, trolley, bird, scarf) with snow spray
// and motion trails → vignette.

import { ARENA_H, ARENA_W, TUNE } from '../sim/constants';
import { spokeAngle, radiusAt, type Floe } from '../sim/floe';
import type { Penguin, World, WorldEvent } from '../sim/world';

type Splash = { x: number; y: number; age: number };
type Cube = { x: number; y: number; born: number; color: string };
type Spray = { x: number; y: number; vx: number; vy: number; age: number };

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
    }
  }

  draw(w: World, dtMs: number): void {
    this.t += dtMs / 1000;
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;

    this.ctx.fillStyle = '#070a20';
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
    this.scene(target, w, dtMs);
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
    this.sky(c);
    this.horizon(c);
    this.water(c);
    this.floe(c, w.floe);
    this.updateSplashes(c, dtMs);
    this.updateCubes(c);
    this.emitSpray(w);
    this.updateSpray(c, dtMs);
    const sorted = [...w.penguins].filter((p) => p.alive).sort((a, b) => a.pos.y - b.pos.y);
    for (const p of sorted) this.penguin(c, p);
    this.vignette(c);
  }

  private sky(c: CanvasRenderingContext2D): void {
    const g = c.createLinearGradient(0, 0, 0, ARENA_H * 0.45);
    g.addColorStop(0, '#060822');
    g.addColorStop(0.7, '#101c48');
    g.addColorStop(1, '#233a68');
    c.fillStyle = g;
    c.fillRect(0, 0, ARENA_W, ARENA_H * 0.45);

    for (const s of this.stars) {
      c.globalAlpha = 0.35 + 0.55 * Math.abs(Math.sin(this.t * 0.8 + s.tw));
      c.fillStyle = '#dceaff';
      c.fillRect(s.x, s.y, s.r, s.r);
    }
    c.globalAlpha = 1;

    // moon with halo
    c.save();
    c.shadowColor = '#cfe4ff';
    c.shadowBlur = 40;
    c.fillStyle = '#e8f2ff';
    c.beginPath();
    c.arc(ARENA_W * 0.84, ARENA_H * 0.10, 34, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(180, 200, 230, .35)';
    c.beginPath();
    c.arc(ARENA_W * 0.845, ARENA_H * 0.094, 7, 0, Math.PI * 2);
    c.arc(ARENA_W * 0.833, ARENA_H * 0.112, 5, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // aurora: layered drifting ribbons with soft vertical curtains
    c.save();
    c.globalCompositeOperation = 'lighter';
    const ribbons = [
      { hue: 140, speed: 0.25, base: 120, amp: 40, alpha: 0.11 },
      { hue: 170, speed: 0.15, base: 190, amp: 55, alpha: 0.07 },
      { hue: 285, speed: 0.20, base: 240, amp: 48, alpha: 0.07 },
      { hue: 320, speed: 0.31, base: 80, amp: 30, alpha: 0.06 },
    ];
    for (const r of ribbons) {
      c.beginPath();
      for (let x = 0; x <= ARENA_W; x += 24) {
        const y = r.base
          + Math.sin(x * 0.005 + this.t * r.speed * 2) * r.amp
          + Math.sin(x * 0.013 - this.t * r.speed) * r.amp * 0.4;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.lineWidth = 70;
      c.lineCap = 'round';
      c.strokeStyle = `hsla(${r.hue}, 90%, 65%, ${r.alpha})`;
      c.stroke();
      c.lineWidth = 26;
      c.strokeStyle = `hsla(${r.hue}, 95%, 78%, ${r.alpha * 1.5})`;
      c.stroke();
      // curtains: faint vertical streamers hanging from the ribbon
      for (let x = 60; x < ARENA_W; x += 170) {
        const y = r.base + Math.sin(x * 0.005 + this.t * r.speed * 2) * r.amp;
        const h = 90 + Math.sin(this.t * 0.9 + x) * 35;
        const grad = c.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, `hsla(${r.hue}, 90%, 70%, ${r.alpha * 1.2})`);
        grad.addColorStop(1, 'transparent');
        c.fillStyle = grad;
        c.fillRect(x - 14, y, 28, h);
      }
    }
    c.restore();
  }

  private horizon(c: CanvasRenderingContext2D): void {
    // distant icebergs on the waterline
    const bergs = [
      { x: 140, w: 260, h: 90 }, { x: 520, w: 180, h: 58 },
      { x: 1450, w: 300, h: 105 }, { x: 1130, w: 150, h: 44 },
    ];
    const yBase = ARENA_H * 0.44;
    for (const b of bergs) {
      c.beginPath();
      c.moveTo(b.x, yBase);
      c.lineTo(b.x + b.w * 0.22, yBase - b.h);
      c.lineTo(b.x + b.w * 0.48, yBase - b.h * 0.55);
      c.lineTo(b.x + b.w * 0.7, yBase - b.h * 0.9);
      c.lineTo(b.x + b.w, yBase);
      c.closePath();
      c.fillStyle = '#2c4468';
      c.fill();
    }
    // the Arctic Mart — where the trolleys came from
    const sx = 1490;
    const sy = yBase - 108;
    c.fillStyle = '#22344f';
    c.fillRect(sx, sy + 46, 150, 62);
    c.save();
    c.shadowColor = '#ff5ad0';
    c.shadowBlur = 18;
    c.fillStyle = '#ff8adf';
    c.font = 'bold 26px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    const flicker = Math.sin(this.t * 11) > -0.92 ? 1 : 0.35; // neon stutter
    c.globalAlpha = flicker;
    c.fillText('ARCTIC MART', sx + 75, sy + 36);
    c.globalAlpha = flicker * 0.85;
    c.font = 'bold 13px "Segoe UI", sans-serif';
    c.fillText('OPEN 24/7', sx + 75, sy + 76);
    c.restore();
  }

  private water(c: CanvasRenderingContext2D): void {
    const g = c.createLinearGradient(0, ARENA_H * 0.42, 0, ARENA_H);
    g.addColorStop(0, '#11576b');
    g.addColorStop(0.5, '#0b3f52');
    g.addColorStop(1, '#062836');
    c.fillStyle = g;
    c.fillRect(0, ARENA_H * 0.42, ARENA_W, ARENA_H * 0.58);

    // drifting wave strokes + aurora reflection shimmer
    c.save();
    for (let i = 0; i < 14; i++) {
      const y = ARENA_H * 0.46 + i * 52;
      const drift = Math.sin(this.t * 0.5 + i * 1.7) * 30;
      c.globalAlpha = 0.05 + (i % 3) * 0.015;
      c.strokeStyle = i % 4 === 0 ? '#7dffb2' : i % 4 === 2 ? '#d98cff' : '#bfe9ff';
      c.lineWidth = 2.5;
      c.beginPath();
      for (let x = -40; x <= ARENA_W + 40; x += 60) {
        const wy = y + Math.sin(x * 0.02 + this.t * 1.2 + i) * 4;
        x === -40 ? c.moveTo(x + drift, wy) : c.lineTo(x + drift, wy);
      }
      c.stroke();
    }
    c.restore();
  }

  private floePath(c: CanvasRenderingContext2D, f: Floe, inset: number, wobblePhase = 0): void {
    c.beginPath();
    for (let i = 0; i < f.radii.length; i++) {
      const a = spokeAngle(i);
      const wob = wobblePhase ? Math.sin(a * 5 + this.t * 2) * 3 : 0;
      const r = Math.max(f.radii[i] - inset + wob, 0);
      const x = f.cx + Math.cos(a) * r;
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
    const g = c.createRadialGradient(f.cx - 120, f.cy - 160, 60, f.cx, f.cy, TUNE.FLOE_RADIUS * 1.15);
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
      c.arc(f.cx + Math.cos(s.a) * rr, f.cy + Math.sin(s.a) * rr, s.r, 0, Math.PI * 2);
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

  /** Eliminated penguins bob past frozen in an ice cube — the spec's promise. */
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
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      c.globalAlpha = Math.max(0.7 - s.age * 1.6, 0);
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(s.x, s.y, 3.2, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    this.spray = this.spray.filter((s) => s.age < 0.5);
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
