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
  private steerBar?: HTMLElement;
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
      <div style="font-size:52px">🛒</div>
      <div style="font-size:24px;font-weight:700;color:#04121f">Grab your trolley!</div>
      <div style="font-size:17px;color:#04121f;opacity:.75;max-width:320px">
        ${sim
          ? 'Sim mode: ← → keys steer, Space is your button.'
          : 'Hold the phone sideways with both hands, like a steering wheel facing you.'}
      </div>
      <button id="cal" style="font-size:20px;padding:16px 40px;border-radius:14px;
        border:none;background:#04121f;color:#fff;font-weight:700">TAP WHEN READY</button>`);
    this.root.querySelector('#cal')!.addEventListener('click', () => {
      this.ensureAudio();
      this.handlers.onCalibrateTap();
    });
  }

  showPlay(name: string): void {
    this.base(this.color, `
      <div style="position:absolute;top:14px;left:0;right:0;display:flex;justify-content:center">
        <div style="width:60%;height:8px;background:rgba(0,0,0,.25);border-radius:4px;overflow:hidden">
          <div id="steerbar" style="height:100%;width:4%;margin-left:48%;background:#04121f;border-radius:4px"></div>
        </div></div>
      <div id="flat" style="position:absolute;top:34px;font-size:15px;color:#04121f;
        font-weight:700;visibility:hidden">📱 Lift your handlebar!</div>
      <div style="font-size:17px;color:#04121f;opacity:.7">${name}</div>
      <button id="act" style="font-size:30px;width:200px;height:200px;border-radius:50%;
        border:8px solid rgba(0,0,0,.25);background:rgba(255,255,255,.85);color:#04121f;
        font-weight:800;touch-action:none">HONK</button>
      <div style="font-size:14px;color:#04121f;opacity:.55">tilt to steer</div>`);
    this.steerBar = this.root.querySelector('#steerbar')!;
    this.flatNudge = this.root.querySelector('#flat')!;
    const btn = this.root.querySelector<HTMLButtonElement>('#act')!;
    const press = (down: boolean) => (e: Event) => { e.preventDefault(); this.handlers.onAction(down); };
    btn.addEventListener('pointerdown', press(true));
    btn.addEventListener('pointerup', press(false));
    btn.addEventListener('pointercancel', press(false));
  }

  /** Live updates inside the play state. */
  updatePlay(steer: number, flat: boolean): void {
    if (this.steerBar) {
      const pct = 4 + Math.abs(steer) * 46;
      this.steerBar.style.width = `${pct}%`;
      this.steerBar.style.marginLeft = steer < 0 ? `${50 - pct}%` : '50%';
    }
    if (this.flatNudge) this.flatNudge.style.visibility = flat ? 'visible' : 'hidden';
  }

  showBomb(): void {
    this.base('#120607', `
      <div id="bombface" style="font-size:110px;transition:transform .1s">💣</div>
      <div style="font-size:24px;font-weight:800;color:#ff5a5f">YOU HAVE THE BOMB</div>
      <button id="act" style="font-size:26px;padding:20px 48px;border-radius:16px;
        border:4px solid #ff5a5f;background:#2a0d10;color:#fff;font-weight:800">THROW</button>
      <div style="font-size:15px;opacity:.6">get close to someone… then throw!</div>`);
    const btn = this.root.querySelector<HTMLButtonElement>('#act')!;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.handlers.onAction(true); });
    btn.addEventListener('pointerup', (e) => { e.preventDefault(); this.handlers.onAction(false); });
    this.steerBar = undefined;
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
