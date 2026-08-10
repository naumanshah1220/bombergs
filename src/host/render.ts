// Arena renderer: everything procedural on Canvas 2D. Press P to toggle retro
// mode — the same scene rendered at quarter resolution and upscaled with
// smoothing off, i.e. free pixel art (the A/B we owe the art direction call).

import { ARENA_H, ARENA_W, PENGUIN_RADIUS } from '../sim/constants';
import { spokeAngle, type Floe } from '../sim/floe';
import type { World, WorldEvent } from '../sim/world';

type Splash = { x: number; y: number; age: number };

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private low: HTMLCanvasElement;      // retro-mode offscreen target
  private lowCtx: CanvasRenderingContext2D;
  retro = false;
  private splashes: Splash[] = [];
  private t = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.low = document.createElement('canvas');
    this.low.width = ARENA_W / 4;
    this.low.height = ARENA_H / 4;
    this.lowCtx = this.low.getContext('2d')!;
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'p') this.retro = !this.retro;
    });
  }

  addEvents(events: WorldEvent[]): void {
    for (const e of events) {
      if (e.kind === 'splash') this.splashes.push({ x: e.at.x, y: e.at.y, age: 0 });
    }
  }

  draw(w: World, dtMs: number): void {
    this.t += dtMs / 1000;
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;

    // letterbox bars match the sky so the arena floats seamlessly
    this.ctx.fillStyle = '#0a0d2e';
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
      this.ctx.fillStyle = '#04060f';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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
    this.water(c);
    this.floe(c, w.floe);
    this.updateSplashes(c, dtMs);
    const sorted = [...w.penguins].filter((p) => p.alive).sort((a, b) => a.pos.y - b.pos.y);
    for (const p of sorted) this.penguin(c, p.pos.x, p.pos.y, p.heading, p.color, p.name);
  }

  private sky(c: CanvasRenderingContext2D): void {
    const g = c.createLinearGradient(0, 0, 0, ARENA_H);
    g.addColorStop(0, '#0a0d2e');
    g.addColorStop(0.5, '#14295e');
    g.addColorStop(1, '#2c4a7c');
    c.fillStyle = g;
    c.fillRect(0, 0, ARENA_W, ARENA_H);
    // aurora: three additive sine ribbons drifting at different speeds
    c.save();
    c.globalCompositeOperation = 'lighter';
    const ribbons = [
      { hue: 140, speed: 0.25, base: 90, amp: 34, alpha: 0.10 },
      { hue: 280, speed: 0.18, base: 150, amp: 46, alpha: 0.08 },
      { hue: 320, speed: 0.32, base: 60, amp: 26, alpha: 0.06 },
    ];
    for (const r of ribbons) {
      c.beginPath();
      for (let x = 0; x <= ARENA_W; x += 16) {
        const y = r.base
          + Math.sin(x * 0.006 + this.t * r.speed * 2) * r.amp
          + Math.sin(x * 0.017 - this.t * r.speed) * r.amp * 0.4;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.lineWidth = 55;
      c.lineCap = 'round';
      c.strokeStyle = `hsla(${r.hue}, 90%, 65%, ${r.alpha})`;
      c.stroke();
      c.lineWidth = 20;
      c.strokeStyle = `hsla(${r.hue}, 95%, 75%, ${r.alpha * 1.6})`;
      c.stroke();
    }
    c.restore();
  }

  private water(c: CanvasRenderingContext2D): void {
    const g = c.createLinearGradient(0, ARENA_H * 0.3, 0, ARENA_H);
    g.addColorStop(0, '#0d4f5c');
    g.addColorStop(1, '#062e38');
    c.fillStyle = g;
    c.fillRect(0, ARENA_H * 0.28, ARENA_W, ARENA_H * 0.72);
    // aurora shimmer lines on the water
    c.save();
    c.globalAlpha = 0.07;
    for (let i = 0; i < 5; i++) {
      const y = ARENA_H * 0.35 + i * 90 + Math.sin(this.t * 0.7 + i) * 6;
      c.fillStyle = i % 2 ? '#7dffb2' : '#d98cff';
      c.fillRect(80 + i * 60, y, ARENA_W - 300, 3);
    }
    c.restore();
  }

  private floe(c: CanvasRenderingContext2D, f: Floe): void {
    const path = (inset: number) => {
      c.beginPath();
      for (let i = 0; i < f.radii.length; i++) {
        const a = spokeAngle(i);
        const r = Math.max(f.radii[i] - inset, 0);
        const x = f.cx + Math.cos(a) * r;
        const y = f.cy + Math.sin(a) * r;
        i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.closePath();
    };
    // submerged rim (blue ice under waterline)
    c.save();
    c.translate(0, 10);
    path(0);
    c.fillStyle = '#5d9bc4';
    c.fill();
    c.restore();
    // top surface with a soft sunset tint
    path(0);
    const g = c.createLinearGradient(f.cx, f.cy - 400, f.cx, f.cy + 400);
    g.addColorStop(0, '#f6fbff');
    g.addColorStop(1, '#dceaf5');
    c.fillStyle = g;
    c.fill();
    path(0);
    c.lineWidth = 5;
    c.strokeStyle = '#bcd9ec';
    c.stroke();
  }

  private updateSplashes(c: CanvasRenderingContext2D, dtMs: number): void {
    for (const s of this.splashes) {
      s.age += dtMs / 1000;
      const r = 10 + s.age * 90;
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.lineWidth = Math.max(6 - s.age * 5, 1);
      c.strokeStyle = `rgba(220, 245, 255, ${Math.max(0.8 - s.age, 0)})`;
      c.stroke();
    }
    this.splashes = this.splashes.filter((s) => s.age < 1);
  }

  private penguin(c: CanvasRenderingContext2D, x: number, y: number, heading: number, color: string, name: string): void {
    const R = PENGUIN_RADIUS;
    c.save();
    c.translate(x, y);
    // shadow
    c.beginPath();
    c.ellipse(0, R * 0.8, R * 1.3, R * 0.5, 0, 0, Math.PI * 2);
    c.fillStyle = 'rgba(30, 60, 90, .25)';
    c.fill();
    c.rotate(heading);
    // trolley: basket + four wheels, drawn under the bird
    c.fillStyle = '#9fb4c8';
    c.strokeStyle = '#7a8ea1';
    c.lineWidth = 2;
    c.fillRect(-R * 1.2, -R * 0.9, R * 2.4, R * 1.8);
    c.strokeRect(-R * 1.2, -R * 0.9, R * 2.4, R * 1.8);
    c.fillStyle = '#3a4a5a';
    for (const [wx, wy] of [[-R, -R], [-R, R], [R, -R], [R, R]] as const) {
      c.beginPath();
      c.arc(wx, wy * 0.95, R * 0.28, 0, Math.PI * 2);
      c.fill();
    }
    // handlebar at the back
    c.fillStyle = '#c8d6e2';
    c.fillRect(-R * 1.5, -R * 0.9, R * 0.3, R * 1.8);
    // penguin body (nose points +x)
    c.beginPath();
    c.ellipse(0, 0, R * 1.05, R * 0.85, 0, 0, Math.PI * 2);
    c.fillStyle = '#1c2733';
    c.fill();
    c.beginPath();
    c.ellipse(R * 0.25, 0, R * 0.62, R * 0.5, 0, 0, Math.PI * 2);
    c.fillStyle = '#f4f8fb';
    c.fill();
    // beak
    c.beginPath();
    c.moveTo(R * 1.0, -R * 0.16);
    c.lineTo(R * 1.45, 0);
    c.lineTo(R * 1.0, R * 0.16);
    c.closePath();
    c.fillStyle = '#ffb400';
    c.fill();
    // scarf in player color, with a little tail flapping behind
    c.beginPath();
    c.ellipse(-R * 0.15, 0, R * 0.55, R * 0.45, 0, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.fillRect(-R * 1.05, -R * 0.18, R * 0.55, R * 0.36);
    c.restore();
    // name tag (unrotated)
    c.font = 'bold 13px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(10, 20, 40, .75)';
    c.fillText(name, x, y - R * 1.7);
  }
}
