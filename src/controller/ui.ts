// Controller DOM: one full-screen state at a time. No framework — states are
// small enough that innerHTML swaps + a few live element refs stay readable.

import type { AbilityId } from '../shared/protocol';

export type UiHandlers = {
  onJoin(name: string): void;
  onCalibrateTap(): void;
  onAction(pressed: boolean): void;
  onDraftPick(index: 0 | 1 | 2): void;
  onSimAngle?(deg: number): void;
};

const NAMES = ['Waddles', 'Pebble', 'Flipper', 'Frosty', 'Squawk', 'Tux', 'Blizzard', 'Pingu'];

const ABILITY_INFO: Record<AbilityId, { icon: string; name: string; desc: string }> = {
  blink: { icon: '✨', name: 'Blink', desc: 'Teleport somewhere nearby. Somewhere.' },
  dash: { icon: '💨', name: 'Dash', desc: 'A burst of speed, right now.' },
  shield: { icon: '🛡️', name: 'Ice Shield', desc: 'Bounce a landing bomb at someone else.' },
};

export class ControllerUi {
  private root: HTMLElement;
  private handlers: UiHandlers;
  private wheel?: HTMLElement;
  private flatNudge?: HTMLElement;
  private audio?: AudioContext;
  private tickTimer?: number;
  color = '#29B6F6';

  constructor(root: HTMLElement, handlers: UiHandlers) {
    this.root = root;
    this.handlers = handlers;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) this.handlers.onAction(true);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.handlers.onAction(false);
    });
  }

  /** Must be called from a user gesture before any tick sounds. */
  ensureAudio(): void {
    this.audio ??= new AudioContext();
    void this.audio.resume();
  }

  private base(bg: string, inner: string): void {
    this.root.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;align-items:center;
                  justify-content:center;gap:18px;background:${bg};padding:24px;
                  text-align:center;transition:background .3s">${inner}</div>`;
  }

  showJoin(room: string, connecting: boolean): void {
    const name = localStorage.getItem('bombergs-name')
      ?? NAMES[Math.floor(Math.random() * NAMES.length)];
    this.base('#0b1026', `
      <div style="font-size:15px;letter-spacing:4px;opacity:.6">ROOM ${room}</div>
      <div style="font-size:34px">🐧</div>
      <input id="name" maxlength="10" value="${name}" style="font-size:22px;padding:12px;
        border-radius:12px;border:2px solid #29B6F6;background:#131a3a;color:#eaf6ff;
        text-align:center;width:70%"/>
      <button id="join" style="font-size:22px;padding:14px 42px;border-radius:14px;
        border:none;background:#29B6F6;color:#04121f;font-weight:700">
        ${connecting ? 'Connecting…' : 'JOIN'}</button>`);
    const input = this.root.querySelector<HTMLInputElement>('#name')!;
    this.root.querySelector('#join')!.addEventListener('click', () => {
      const n = input.value.trim() || 'Penguin';
      localStorage.setItem('bombergs-name', n);
      this.ensureAudio();
      this.handlers.onJoin(n);
    });
  }

  showCalibrate(sim: boolean): void {
    this.base(this.color, `
      <style>
        #rotate-hint { display: none; }
        @media (orientation: portrait) { #rotate-hint { display: block; } }
      </style>
      <div style="font-size:52px">🛒</div>
      <div style="font-size:24px;font-weight:700;color:#04121f">Grab your trolley!</div>
      <div style="font-size:17px;color:#04121f;opacity:.75;max-width:320px">
        ${sim
          ? 'Sim mode: ← → keys steer, Space is your button.'
          : 'Hold the phone sideways with both hands, like a steering wheel facing you.'}
      </div>
      ${sim ? '' : `<div id="rotate-hint" style="font-size:17px;font-weight:700;color:#04121f;
        background:rgba(255,255,255,.5);padding:10px 18px;border-radius:12px">
        🔄 Turn your phone sideways!</div>`}
      <button id="cal" style="font-size:20px;padding:16px 40px;border-radius:14px;
        border:none;background:#04121f;color:#fff;font-weight:700">TAP WHEN READY</button>`);
    this.root.querySelector('#cal')!.addEventListener('click', () => {
      this.ensureAudio();
      this.handlers.onCalibrateTap();
    });
  }

  showPlay(name: string): void {
    // The wheel is the feedback: it rotates exactly as much as the game
    // thinks you're steering, so grip direction is self-teaching.
    this.base(this.color, `
      <div id="flat" style="position:absolute;top:24px;font-size:15px;color:#04121f;
        font-weight:700;visibility:hidden">📱 Lift your handlebar!</div>
      <div style="font-size:17px;color:#04121f;opacity:.7">${name}</div>
      <div id="wheel" style="position:relative;width:min(260px,56vmin);height:min(260px,56vmin);will-change:transform">
        <svg viewBox="0 0 100 100" style="width:100%;height:100%">
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="8"/>
          <line x1="50" y1="8" x2="50" y2="30" stroke="rgba(0,0,0,.35)" stroke-width="6" stroke-linecap="round"/>
          <line x1="8" y1="50" x2="30" y2="50" stroke="rgba(0,0,0,.35)" stroke-width="6" stroke-linecap="round"/>
          <line x1="70" y1="50" x2="92" y2="50" stroke="rgba(0,0,0,.35)" stroke-width="6" stroke-linecap="round"/>
          <line x1="50" y1="70" x2="50" y2="92" stroke="rgba(0,0,0,.35)" stroke-width="6" stroke-linecap="round"/>
          <circle cx="50" cy="12" r="5" fill="#04121f"/>
        </svg>
        <button id="act" style="position:absolute;inset:0;margin:auto;font-size:24px;
          width:50%;height:50%;border-radius:50%;border:6px solid rgba(0,0,0,.25);
          background:rgba(255,255,255,.88);color:#04121f;font-weight:800;
          pointer-events:none;transition:transform .08s">HONK</button>
      </div>
      <div style="font-size:14px;color:#04121f;opacity:.55">tilt to steer · tap anywhere to honk</div>`);
    this.wheel = this.root.querySelector('#wheel')!;
    this.flatNudge = this.root.querySelector('#flat')!;
    this.bindTapAnywhere(() => this.blip(340, 0.12));
  }

  /**
   * The whole screen is the action button — one verb at a time means there's
   * nothing to aim for. The visual button is pointer-events:none decoration.
   */
  private bindTapAnywhere(feedback?: () => void): void {
    const state = this.root.firstElementChild as HTMLElement;
    const btn = this.root.querySelector<HTMLElement>('#act');
    const press = (down: boolean) => (e: Event) => {
      e.preventDefault();
      if (down) feedback?.();
      if (btn) btn.style.transform = down ? 'scale(.9)' : 'scale(1)';
      this.handlers.onAction(down);
    };
    state.addEventListener('pointerdown', press(true));
    state.addEventListener('pointerup', press(false));
    state.addEventListener('pointercancel', press(false));
  }

  /** Live updates inside the play state. */
  updatePlay(steer: number, flat: boolean): void {
    if (this.wheel) this.wheel.style.transform = `rotate(${steer * 60}deg)`;
    if (this.flatNudge) this.flatNudge.style.visibility = flat ? 'visible' : 'hidden';
  }

  showBomb(): void {
    this.base('#120607', `
      <div id="bombface" style="font-size:110px;transition:transform .1s">💣</div>
      <div style="font-size:24px;font-weight:800;color:#ff5a5f">YOU HAVE THE BOMB</div>
      <button id="act" style="font-size:26px;padding:20px 48px;border-radius:16px;
        border:4px solid #ff5a5f;background:#2a0d10;color:#fff;font-weight:800;
        pointer-events:none;transition:transform .08s">THROW</button>
      <div style="font-size:15px;opacity:.6">get close to someone… tap anywhere to throw!</div>`);
    this.bindTapAnywhere();
    this.wheel = undefined;
    this.flatNudge = undefined;
  }

  /** Accelerating tick while carrying; fuseFrac 0 = fresh, 1 = about to blow. */
  setFuse(fuseFrac: number): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    const rate = 1.5 + 8 * fuseFrac; // Hz
    const tick = () => {
      this.blip(200 + fuseFrac * 500, 0.06);
      navigator.vibrate?.(50);
      const face = this.root.querySelector<HTMLElement>('#bombface');
      if (face) {
        face.style.transform = `scale(${1 + fuseFrac * 0.25})`;
        setTimeout(() => { face.style.transform = 'scale(1)'; }, 60);
      }
      this.tickTimer = window.setTimeout(tick, 1000 / rate);
    };
    tick();
  }

  stopFuse(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = undefined;
  }

  showDead(placement: number): void {
    this.stopFuse();
    const medal = placement === 1 ? '🏆 WINNER!' : `#${placement}`;
    this.base('#0b1026', `
      <div style="font-size:60px">🧊</div>
      <div style="font-size:30px;font-weight:800">${medal}</div>
      <div style="font-size:16px;opacity:.6">frozen… waiting for next stage</div>`);
  }

  showWaiting(text: string): void {
    this.stopFuse();
    this.base('#0b1026', `
      <div style="font-size:60px">🐧</div>
      <div style="font-size:20px;opacity:.8">${text}</div>`);
  }

  showDraft(options: AbilityId[]): void {
    this.stopFuse();
    const cards = options.map((id, i) => {
      const a = ABILITY_INFO[id];
      return `<button class="card" data-i="${i}" style="flex:1;padding:18px 8px;border-radius:16px;
        border:3px solid ${this.color};background:#131a3a;color:#eaf6ff">
        <div style="font-size:40px">${a.icon}</div>
        <div style="font-size:18px;font-weight:700;margin:6px 0">${a.name}</div>
        <div style="font-size:13px;opacity:.7">${a.desc}</div></button>`;
    }).join('');
    this.base('#0b1026', `
      <div style="font-size:22px;font-weight:700">Pick your ability</div>
      <div style="display:flex;gap:10px;width:100%">${cards}</div>`);
    this.root.querySelectorAll<HTMLButtonElement>('.card').forEach((btn) =>
      btn.addEventListener('click', () => this.handlers.onDraftPick(Number(btn.dataset.i) as 0 | 1 | 2)));
  }

  showError(msg: string): void {
    this.base('#0b1026', `
      <div style="font-size:44px">🙈</div>
      <div style="font-size:20px;max-width:320px">${msg}</div>`);
  }

  showSimSlider(getAngle: () => number): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;bottom:10px;left:10%;right:10%;z-index:9';
    wrap.innerHTML = `<input id="simslider" type="range" min="-45" max="45" value="0" style="width:100%">`;
    document.body.appendChild(wrap);
    const slider = wrap.querySelector<HTMLInputElement>('#simslider')!;
    slider.addEventListener('input', () => this.handlers.onSimAngle?.(Number(slider.value)));
    setInterval(() => { slider.value = String(getAngle()); }, 100); // spring-back mirror
  }

  private blip(freq: number, dur: number): void {
    if (!this.audio) return;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, this.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + dur);
    osc.connect(gain).connect(this.audio.destination);
    osc.start();
    osc.stop(this.audio.currentTime + dur);
  }
}
