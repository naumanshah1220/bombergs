// Host entry. For this stage of the build it boots straight into the LOBBY +
// CONTROLLER HARNESS: QR pairing, joined-penguin list, live steer bars and tap
// flashes — the place where controller feel gets tuned before the game exists.

import QRCode from 'qrcode';
import { PLAYER_COLORS, controllerUrl } from '../shared/protocol';
import { TUNE, type Tunables } from '../sim/constants';
import { makeWorld, step, type World } from '../sim/world';
import { Renderer } from './render';
import { createRoom, type Room } from './net';

const app = document.getElementById('app')!;
let room: Room | undefined;
let mode: 'lobby' | 'play' = 'lobby';
let world: World | undefined;
let renderer: Renderer | undefined;

function boot(): void {
  app.innerHTML = `<div style="display:grid;place-items:center;height:100%">
    <div style="font-size:24px;opacity:.7">Opening room…</div></div>`;
  createRoom(
    {
      onJoin: () => renderLobby(),
      onInput: () => { /* harness reads state at 30Hz below */ },
      onDraftPick: () => { /* not used in lobby */ },
      onLeave: () => renderLobby(),
    },
    (r) => { room = r; renderLobby(); },
    (err) => {
      app.innerHTML = `<div style="display:grid;place-items:center;height:100%">
        <div style="font-size:22px;color:#ff5a5f">${err}<br/>Reload to retry.</div></div>`;
    },
  );
}

/**
 * Origin phones should join through. Opened via localhost in dev? Swap in the
 * machine's LAN IP (injected at build time) so scanning the QR actually works.
 */
function joinOrigin(): string {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (local && typeof __LAN_HOST__ === 'string' && __LAN_HOST__) {
    return `${location.protocol}//${__LAN_HOST__}:${location.port}`;
  }
  return location.origin;
}

async function renderLobby(): Promise<void> {
  if (!room || mode !== 'lobby') return;
  const join = controllerUrl(joinOrigin(), room.code);
  const insecure = location.protocol === 'http:';
  app.innerHTML = `
    <div style="display:flex;height:100%;align-items:center;justify-content:center;gap:70px;padding:40px">
      <div style="text-align:center">
        <div style="font-size:54px;font-weight:900;letter-spacing:2px">🐧 BOMBERGS</div>
        <div style="opacity:.6;margin:6px 0 26px">scan to grab a trolley</div>
        <canvas id="qr" style="border-radius:16px"></canvas>
        <div style="font-size:44px;font-weight:800;letter-spacing:14px;margin-top:18px">${room.code}</div>
        <div style="opacity:.5;font-size:14px;margin-top:6px">${join}</div>
        ${insecure ? `<div style="margin-top:14px;padding:10px 16px;border-radius:10px;
            background:#3a2a10;color:#ffb400;font-size:14px;max-width:340px">
            ⚠️ HTTP mode: phone tilt sensors won't work.<br/>
            Run <b>npm run dev:phone</b> for HTTPS.</div>` : ''}
      </div>
      <div style="min-width:420px">
        <div style="font-size:20px;opacity:.7;margin-bottom:14px">PENGUINS</div>
        <div id="plist" style="display:flex;flex-direction:column;gap:12px"></div>
        <button id="start" style="margin-top:22px;font-size:22px;padding:14px 46px;
          border-radius:14px;border:none;background:#3DDC84;color:#04121f;
          font-weight:800;cursor:pointer">START (bots fill empty seats)</button>
      </div>
    </div>`;
  document.getElementById('start')!.addEventListener('click', startGame);
  const qrCanvas = document.getElementById('qr') as HTMLCanvasElement;
  await QRCode.toCanvas(qrCanvas, join, { width: 240, margin: 1, color: { dark: '#0b1026', light: '#eaf6ff' } });
  renderList();
}

const DUMMY_NAMES = ['Bot Bergy', 'Bot Floe', 'Bot Chilly'];

/** ?tune=1 — live sliders over the mutable TUNE constants. */
function mountTunePanel(): void {
  if (new URLSearchParams(location.search).get('tune') !== '1') return;
  if (document.getElementById('tune')) return;
  const ranges: Record<keyof Tunables, [number, number]> = {
    BASE_SPEED: [60, 400],
    CARRIER_SPEED_MULT: [1, 2],
    TURN_RATE: [1, 8],
    ICE_GRIP: [1, 12],
    PENGUIN_RADIUS: [10, 40],
    FLOE_RADIUS: [200, 560],
  };
  const wrap = document.createElement('div');
  wrap.id = 'tune';
  wrap.style.cssText = `position:fixed;top:10px;right:10px;z-index:50;background:rgba(6,10,30,.9);
    padding:14px;border-radius:12px;font-size:12px;display:flex;flex-direction:column;gap:6px;width:230px`;
  for (const key of Object.keys(ranges) as (keyof Tunables)[]) {
    const [min, max] = ranges[key];
    const row = document.createElement('label');
    row.innerHTML = `<span style="display:flex;justify-content:space-between">
      <b>${key}</b><span id="tv-${key}">${TUNE[key]}</span></span>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '0.1';
    input.value = String(TUNE[key]);
    input.style.width = '100%';
    input.addEventListener('input', () => {
      TUNE[key] = Number(input.value);
      document.getElementById(`tv-${key}`)!.textContent = input.value;
    });
    row.appendChild(input);
    wrap.appendChild(row);
  }
  const note = document.createElement('div');
  note.style.cssText = 'opacity:.5;margin-top:4px';
  note.textContent = 'FLOE_RADIUS applies next stage';
  wrap.appendChild(note);
  document.body.appendChild(wrap);
}

function startGame(): void {
  if (!room) return;
  mode = 'play';
  mountTunePanel();
  const players = [...room.controllers.values()]
    .filter((c) => c.connected)
    .map((c) => ({ slot: c.slot, name: c.name, color: c.color }));
  // fill to 4 with circling dummies (real bots arrive with the bomb loop)
  const dummies: { slot: number; name: string; color: string; isDummy: boolean }[] = [];
  const taken = new Set(players.map((p) => p.slot));
  for (let i = 0; players.length + dummies.length < 4 && i < PLAYER_COLORS.length; i++) {
    if (taken.has(i)) continue;
    dummies.push({ slot: i, name: DUMMY_NAMES[dummies.length] ?? `Bot ${i}`, color: PLAYER_COLORS[i], isDummy: true });
  }
  world = makeWorld([...players, ...dummies]);
  app.innerHTML = `<canvas id="arena" style="width:100%;height:100%;display:block"></canvas>
    <div id="banner" style="position:fixed;top:30px;left:0;right:0;text-align:center;
      font-size:40px;font-weight:900;text-shadow:0 2px 12px rgba(0,0,0,.6);
      pointer-events:none">GO!</div>`;
  renderer = new Renderer(document.getElementById('arena') as HTMLCanvasElement);
  room.broadcast({ t: 'phase', phase: 'play' });
  setTimeout(() => { const b = document.getElementById('banner'); if (b) b.textContent = ''; }, 1200);

  let last = performance.now();
  let stageOver = false;
  const loop = (now: number): void => {
    if (mode !== 'play' || !world || !renderer || !room) return;
    const dt = Math.min(now - last, 50);
    last = now;
    for (const c of room.controllers.values()) {
      const p = world.penguins.find((q) => q.slot === c.slot);
      if (p && !p.isDummy) p.steer = c.steer;
    }
    const events = step(world, dt);
    renderer.addEvents(events, world);
    for (const e of events) {
      if (e.kind === 'eliminated') {
        const placement = world.penguins.filter((q) => q.alive).length + 1;
        room.sendTo(e.slot, { t: 'status', alive: false, placement, score: 0 });
      }
    }
    // Stage ends when one penguin remains — or when every HUMAN is out
    // (nobody wants to spectate bots forever). Auto-restarts either way.
    const alive = world.penguins.filter((q) => q.alive);
    const humansAlive = alive.filter((q) => !q.isDummy).length;
    const hadHumans = world.penguins.some((q) => !q.isDummy);
    if (!stageOver && (alive.length <= 1 || (hadHumans && humansAlive === 0))) {
      stageOver = true;
      const b = document.getElementById('banner');
      const winner = alive.length === 1 ? alive[0] : undefined;
      if (b) {
        b.innerHTML = `${winner ? `${winner.name} WINS THE STAGE! 🏆` : 'EVERYONE IS SWIMMING 🌊'}<br/>
          <span style="font-size:20px;opacity:.8">next stage in 3…</span>`;
      }
      if (winner && !winner.isDummy) {
        room.sendTo(winner.slot, { t: 'status', alive: false, placement: 1, score: 1 });
      }
      setTimeout(() => { if (mode === 'play') startGame(); }, 3000);
    }
    renderer.draw(world, dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function renderList(): void {
  const list = document.getElementById('plist');
  if (!list || !room) return;
  const rows: string[] = [];
  for (const c of [...room.controllers.values()].sort((a, b) => a.slot - b.slot)) {
    rows.push(`
      <div style="display:flex;align-items:center;gap:14px;background:#131a3a;
                  border-radius:14px;padding:12px 16px;border-left:8px solid ${c.color};
                  opacity:${c.connected ? 1 : 0.4}">
        <div style="font-size:26px">🐧</div>
        <div style="width:110px;font-weight:700">${escapeHtml(c.name)}${c.connected ? '' : ' (lost)'}</div>
        <div style="flex:1;height:10px;background:#0b1026;border-radius:5px;position:relative;overflow:hidden">
          <div id="steer-${c.slot}" style="position:absolute;top:0;bottom:0;left:50%;width:2%;
               background:${c.color};border-radius:5px"></div>
        </div>
        <div id="tap-${c.slot}" style="width:20px;height:20px;border-radius:50%;
             background:#0b1026;border:2px solid ${c.color}"></div>
      </div>`);
  }
  list.innerHTML = rows.length
    ? rows.join('')
    : `<div style="opacity:.4">No penguins yet — scan the code!</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// 30Hz harness refresh: move steer bars + flash taps without rebuilding DOM.
setInterval(() => {
  if (!room) return;
  for (const c of room.controllers.values()) {
    const bar = document.getElementById(`steer-${c.slot}`);
    if (bar) {
      const halfPct = Math.abs(c.steer) * 48;
      bar.style.width = `${Math.max(halfPct, 2)}%`;
      bar.style.left = c.steer < 0 ? `${50 - halfPct}%` : '50%';
    }
    const tap = document.getElementById(`tap-${c.slot}`);
    if (tap) tap.style.background = c.tap ? c.color : '#0b1026';
  }
}, 33);

boot();
