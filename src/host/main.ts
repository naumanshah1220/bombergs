// Host entry: lobby with QR pairing → one continuous Fall-Guys-style match
// (lives, pickups, persistent blast holes) → podium → back to the lobby.

import QRCode from 'qrcode';
import { PLAYER_COLORS, controllerUrl } from '../shared/protocol';
import { fuseFrac, idleBomb } from '../sim/bomb';
import { TUNE, type Tunables } from '../sim/constants';
import { makeWorld, step, type World, type WorldEvent } from '../sim/world';
import { loadAssets, type Assets } from './assets';
import { loadLevels, startMaker } from './maker';
import type { LevelData } from '../sim/island';
import { Sfx } from './audio';
import { Renderer } from './render';
import { createRoom, type Room } from './net';

const app = document.getElementById('app')!;
let room: Room | undefined;
let mode: 'lobby' | 'play' | 'practice' = 'lobby';
let world: World | undefined;
let renderer: Renderer | undefined;
let sfx: Sfx | undefined;
let assets: Assets | undefined;
// Every match/practice start bumps this; stale rAF loops see the bump and die.
// (A missing guard here once made each new stage silently double the sim rate.)
let loopGen = 0;

type Roster = { slot: number; name: string; color: string; isBot: boolean };
let roster: Roster[] = [];
let selectedLevel = '';

function pickedLevel(): LevelData | undefined {
  return selectedLevel ? loadLevels()[selectedLevel] : undefined;
}
let placements: number[] = []; // slots in elimination order (first out first)

function boot(): void {
  if (new URLSearchParams(location.search).get('maker') === '1') {
    void loadAssets().then((a) => startMaker(app, a));
    return;
  }
  app.innerHTML = `<div style="display:grid;place-items:center;height:100%">
    <div style="font-size:24px;opacity:.7">Opening room…</div></div>`;
  void loadAssets().then((a) => { assets = a; });
  createRoom(
    {
      onJoin: () => renderLobby(),
      onInput: () => { /* play loop polls controller state directly */ },
      onDraftPick: () => { /* drafts retired — abilities are map pickups now */ },
      onLeave: () => renderLobby(),
    },
    (r) => { room = r; renderLobby(); },
    (err) => {
      app.innerHTML = `<div style="display:grid;place-items:center;height:100%">
        <div style="font-size:22px;color:#ff5a5f">${err}<br/>Reload to retry.</div></div>`;
    },
  );
}

type JoinTarget = { label: string; origin: string; hint: string };

/**
 * Every origin a phone could join through, best first. Which one works depends
 * on how the phone is connected, and that changes constantly during testing —
 * so the lobby offers all of them rather than betting on one.
 */
function joinTargets(): JoinTarget[] {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const out: JoinTarget[] = [];
  if (!local) {
    out.push({
      label: location.hostname.endsWith('.trycloudflare.com') ? 'Tunnel' : 'This page',
      origin: location.origin,
      hint: 'the address this page is already open on',
    });
  }
  const port = location.port ? `:${location.port}` : '';
  for (const { label, host } of typeof __NET_HOSTS__ === 'undefined' ? [] : __NET_HOSTS__) {
    const origin = `${location.protocol}//${host}${port}`;
    if (out.some((t) => t.origin === origin)) continue;
    out.push({
      label,
      origin,
      hint: label === 'Tailscale'
        ? 'works on ANY network — the phone must have Tailscale switched on'
        : label === 'PC hotspot'
          ? 'only if the phone is connected to this PC’s hotspot'
          : 'phone must be on the same Wi-Fi as this PC',
    });
  }
  if (!out.length) out.push({ label: 'This page', origin: location.origin, hint: '' });
  return out;
}

const JOIN_PREF_KEY = 'bombergs-join-label';

function pickJoinTarget(): JoinTarget {
  const targets = joinTargets();
  const saved = localStorage.getItem(JOIN_PREF_KEY);
  return targets.find((t) => t.label === saved) ?? targets[0];
}

async function renderLobby(): Promise<void> {
  if (!room || mode !== 'lobby') return;
  const targets = joinTargets();
  const active = pickJoinTarget();
  const join = controllerUrl(active.origin, room.code);
  const insecure = location.protocol === 'http:';
  app.innerHTML = `
    <div style="display:flex;height:100%;align-items:center;justify-content:center;gap:70px;padding:40px">
      <div style="text-align:center">
        <div style="font-size:54px;font-weight:900;letter-spacing:2px">🧨 BOMBERGS</div>
        <div style="opacity:.6;margin:6px 0 26px">scan to join the goblins</div>
        <canvas id="qr" style="border-radius:16px"></canvas>
        <div style="font-size:44px;font-weight:800;letter-spacing:14px;margin-top:18px">${room.code}</div>
        ${targets.length > 1 ? `<div id="joinpick" style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap">
          ${targets.map((t) => `<button data-label="${t.label}" style="padding:6px 14px;border-radius:999px;font-weight:700;
            cursor:pointer;border:2px solid #29B6F6;font-size:13px;
            background:${t.label === active.label ? '#29B6F6' : 'transparent'};
            color:${t.label === active.label ? '#04121f' : '#29B6F6'}">${t.label}</button>`).join('')}
        </div>` : ''}
        <div style="opacity:.5;font-size:14px;margin-top:8px">${join}</div>
        ${active.hint ? `<div style="opacity:.4;font-size:12px;margin-top:2px">${active.hint}</div>` : ''}
        ${insecure ? `<div style="margin-top:14px;padding:10px 16px;border-radius:10px;
            background:#3a2a10;color:#ffb400;font-size:14px;max-width:340px">
            ⚠️ HTTP mode (dev): fine for joystick controls.</div>` : ''}
      </div>
      <div style="min-width:420px">
        <div style="font-size:20px;opacity:.7;margin-bottom:14px">GOBLINS</div>
        <div id="plist" style="display:flex;flex-direction:column;gap:12px"></div>
        <button id="start" style="margin-top:22px;font-size:22px;padding:14px 46px;
          border-radius:14px;border:none;background:#3DDC84;color:#04121f;
          font-weight:800;cursor:pointer">START (bots fill empty seats)</button>
        <button id="practice" style="margin-top:12px;font-size:17px;padding:11px 34px;
          border-radius:12px;border:2px solid #29B6F6;background:transparent;color:#29B6F6;
          font-weight:700;cursor:pointer;display:block">🎯 PRACTICE — walk around, tune the controls</button>
        <div style="margin-top:14px">
          <select id="levelsel" style="padding:8px;background:#131a3a;color:#eaf6ff;
            border:1px solid #29B6F6;border-radius:8px;min-width:220px"></select>
          <a href="/?maker=1" style="color:#29B6F6;margin-left:10px">🛠 map maker</a>
        </div>
      </div>
    </div>`;
  document.getElementById('start')!.addEventListener('click', startMatch);
  document.getElementById('practice')!.addEventListener('click', startPractice);
  document.getElementById('joinpick')?.addEventListener('click', (e) => {
    const label = (e.target as HTMLElement).dataset.label;
    if (!label) return;
    localStorage.setItem(JOIN_PREF_KEY, label);
    void renderLobby(); // same room, new QR — phones already joined stay joined
  });
  const levelSel = document.getElementById('levelsel') as HTMLSelectElement;
  levelSel.innerHTML = '<option value="">🎲 random island</option>'
    + Object.keys(loadLevels()).map((n) => `<option${n === selectedLevel ? ' selected' : ''}>${n}</option>`).join('');
  levelSel.addEventListener('change', () => { selectedLevel = levelSel.value; });
  const qrCanvas = document.getElementById('qr') as HTMLCanvasElement;
  await QRCode.toCanvas(qrCanvas, join, { width: 240, margin: 1, color: { dark: '#0b1026', light: '#eaf6ff' } });
  renderList();
}

const BOT_NAMES = ['Bot Grubb', 'Bot Snout', 'Bot Wick'];

/** Live sliders over the mutable TUNE constants (?tune=1, or always in practice). */
function mountTunePanel(force = false): void {
  if (!force && new URLSearchParams(location.search).get('tune') !== '1') return;
  if (document.getElementById('tune')) return;
  const ranges: Record<keyof Tunables, [number, number]> = {
    BASE_SPEED: [60, 400],
    CARRIER_SPEED_MULT: [1, 2],
    TURN_RATE: [1, 8],
    ICE_GRIP: [1, 12],
    PENGUIN_RADIUS: [10, 40],
    BOT_SPEED_MULT: [0.4, 1.2],
    STICK_GRIP_MULT: [1, 3],
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
  note.textContent = 'physics apply live';
  wrap.appendChild(note);
  document.body.appendChild(wrap);
}

function buildRoster(): Roster[] {
  if (!room) return [];
  const players: Roster[] = [...room.controllers.values()]
    .filter((c) => c.connected)
    .map((c) => ({ slot: c.slot, name: c.name, color: c.color, isBot: false }));
  const taken = new Set(players.map((p) => p.slot));
  for (let i = 0; players.length < 4 && i < PLAYER_COLORS.length; i++) {
    if (taken.has(i)) continue;
    const botCount = players.filter((p) => p.isBot).length;
    players.push({ slot: i, name: BOT_NAMES[botCount] ?? `Bot ${i}`, color: PLAYER_COLORS[i], isBot: true });
    taken.add(i);
  }
  return players;
}

function renderLivesBar(): void {
  const bar = document.getElementById('livesbar');
  if (!bar || !world) return;
  bar.innerHTML = roster
    .map((r) => {
      const p = world!.penguins.find((q) => q.slot === r.slot);
      if (!p) return '';
      const hearts = p.alive ? '❤'.repeat(p.lives) : '💀';
      return `<span style="background:rgba(6,12,30,.72);border-left:5px solid ${r.color};
        padding:5px 12px;border-radius:8px;margin-right:8px;font-weight:700;
        opacity:${p.alive ? 1 : 0.45}">${r.name} <span style="color:#ff5a6e">${hearts}</span></span>`;
    })
    .join('');
}

function gameScreenDom(bannerHtml: string): void {
  app.innerHTML = `<canvas id="arena" style="width:100%;height:100%;display:block"></canvas>
    <div id="livesbar" style="position:fixed;top:14px;left:16px;font-size:15px;pointer-events:none"></div>
    <div id="banner" style="position:fixed;top:80px;left:0;right:0;text-align:center;
      font-size:40px;font-weight:900;text-shadow:0 2px 12px rgba(0,0,0,.6);
      pointer-events:none">${bannerHtml}</div>`;
}

function playSfx(e: WorldEvent): void {
  switch (e.kind) {
    case 'explode': sfx?.explosion(); break;
    case 'splash': sfx?.splash(); break;
    case 'honk': sfx?.honk(); break;
    case 'throw': sfx?.throwWhoosh(); break;
    case 'stick': sfx?.stick(); break;
    case 'blink': sfx?.blink(); break;
    case 'shieldUp': sfx?.shield(); break;
    case 'dash': sfx?.throwWhoosh(); break;
    case 'bounce': sfx?.stick(); break;
    case 'pickup': sfx?.blink(); break;
  }
}

/** Shared per-frame plumbing: inputs in, bomb state out to phones. */
function makeLoopHelpers(): {
  applyInputs: () => void;
  syncBombPhones: (now: number) => void;
} {
  const prevTaps = new Map<number, boolean>();
  let lastCarrier: number | undefined;
  let lastFuseSend = 0;
  return {
    applyInputs() {
      if (!room || !world) return;
      for (const c of room.controllers.values()) {
        const p = world.penguins.find((q) => q.slot === c.slot);
        if (!p || p.isDummy) continue;
        p.steer = c.steer;
        p.throttle = c.throttle;
        p.move = c.move;
        if (c.tap && !prevTaps.get(c.slot)) p.tap = true; // rising edge only
        prevTaps.set(c.slot, c.tap);
      }
    },
    syncBombPhones(now: number) {
      if (!room || !world) return;
      const carrier = world.bomb.s === 'carried' ? world.bomb.slot : undefined;
      const frac = fuseFrac(world.bomb);
      if (carrier !== lastCarrier) {
        if (lastCarrier !== undefined) room.sendTo(lastCarrier, { t: 'bomb', carrying: false, fuseFrac: 0 });
        if (carrier !== undefined) room.sendTo(carrier, { t: 'bomb', carrying: true, fuseFrac: frac });
        lastCarrier = carrier;
        lastFuseSend = now;
      } else if (carrier !== undefined && now - lastFuseSend > 250) {
        room.sendTo(carrier, { t: 'bomb', carrying: true, fuseFrac: frac });
        lastFuseSend = now;
      }
    },
  };
}

/** One continuous match: 3 lives each, pickups, holes that stay. Last goblin wins. */
function startMatch(): void {
  if (!room) return;
  if (!assets) { setTimeout(startMatch, 300); return; } // sprites still loading
  roster = buildRoster();
  placements = [];
  mode = 'play';
  sfx ??= new Sfx(); // constructed on the START click = user gesture
  sfx.resume();
  mountTunePanel();
  world = makeWorld(roster.map((r) => ({ slot: r.slot, name: r.name, color: r.color, isDummy: r.isBot })), Math.random, undefined, pickedLevel());
  gameScreenDom(`LAST GOBLIN STANDING 💣<br/>
    <span style="font-size:20px;opacity:.85">3 lives each · grab crates for abilities · hearts heal</span>`);
  renderLivesBar();
  renderer = new Renderer(document.getElementById('arena') as HTMLCanvasElement, assets);
  room.broadcast({ t: 'phase', phase: 'play' });
  setTimeout(() => { const b = document.getElementById('banner'); if (b) b.textContent = ''; }, 3000);

  const gen = ++loopGen;
  let last = performance.now();
  let matchOver = false;
  const helpers = makeLoopHelpers();

  const loop = (now: number): void => {
    if (gen !== loopGen || mode !== 'play' || !world || !renderer || !room) return;
    const dt = Math.min(now - last, 50);
    last = now;

    helpers.applyInputs();
    const events = step(world, dt);
    renderer.addEvents(events, world);
    for (const e of events) {
      playSfx(e);
      if (e.kind === 'lifeLost' || e.kind === 'pickup') renderLivesBar();
      if (e.kind === 'pickup' && e.pkind === 'crate' && e.ability) {
        room.sendTo(e.slot, { t: 'ability', id: e.ability });
      }
      if (e.kind === 'eliminated') {
        placements.push(e.slot);
        renderLivesBar();
        const placement = world.penguins.filter((q) => q.alive).length + 1;
        room.sendTo(e.slot, { t: 'status', alive: false, placement, score: 0 });
      }
    }
    helpers.syncBombPhones(now);

    // Match ends with one goblin left — or when every human is out.
    const alive = world.penguins.filter((q) => q.alive);
    const humansAlive = alive.filter((q) => !q.isDummy).length;
    const hadHumans = world.penguins.some((q) => !q.isDummy);
    if (!matchOver && (alive.length <= 1 || (hadHumans && humansAlive === 0))) {
      matchOver = true;
      const winner = alive[0];
      if (winner) {
        placements.push(...alive.map((q) => q.slot));
        sfx?.fanfare();
        room.sendTo(winner.slot, { t: 'status', alive: false, placement: 1, score: 1 });
      }
      const order = [...placements].reverse(); // winner first
      const standings = order
        .map((slot, i) => {
          const r = roster.find((q) => q.slot === slot);
          return `${['🏆', '🥈', '🥉'][i] ?? `${i + 1}.`} ${r?.name ?? '?'}`;
        })
        .join('<br/>');
      const b = document.getElementById('banner');
      if (b) {
        b.innerHTML = `<span style="font-size:52px">${winner ? `${roster.find((q) => q.slot === winner.slot)?.name} WINS!` : 'EVERYONE EXPLODED 💥'}</span><br/>
          <span style="font-size:24px;line-height:1.6">${standings}</span><br/>
          <span style="font-size:18px;opacity:.7">back to the lobby in a moment…</span>`;
      }
      room.broadcast({ t: 'phase', phase: 'gameover' });
      setTimeout(() => {
        mode = 'lobby';
        room?.broadcast({ t: 'phase', phase: 'lobby' });
        void renderLobby();
      }, 8000);
    }

    renderer.draw(world, dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * Practice arena: endless lives, no match end. Walk, bump Coach Grubb, fall
 * in and climb back out — and tune the sliders. B toggles a practice bomb.
 */
function startPractice(): void {
  if (!room) return;
  if (!assets) { setTimeout(startPractice, 300); return; }
  mode = 'practice';
  sfx ??= new Sfx();
  sfx.resume();
  const humans = [...room.controllers.values()]
    .filter((c) => c.connected)
    .map((c) => ({ slot: c.slot, name: c.name, color: c.color }));
  const botSlot = [...Array(8).keys()].find((i) => !humans.some((h) => h.slot === i)) ?? 7;
  roster = [
    ...humans.map((h) => ({ ...h, isBot: false })),
    { slot: botSlot, name: 'Coach Grubb', color: PLAYER_COLORS[botSlot], isBot: true },
  ];
  world = makeWorld(
    roster.map((r) => ({ slot: r.slot, name: r.name, color: r.color, isDummy: r.isBot })),
    Math.random,
    // bomb-free by default: pure walking. B summons/dismisses the bomb.
    { bomb: false, edgeDeath: true, floeBreak: false, lives: 9999 },
  );
  gameScreenDom('🎯 PRACTICE ARENA');
  const hint = document.createElement('div');
  hint.style.cssText = `position:fixed;bottom:18px;left:0;right:0;text-align:center;
    font-size:16px;opacity:.75;pointer-events:none`;
  hint.innerHTML = `free walking — falling in just respawns you ·
    <b>B</b> = practice bomb on/off · tune sliders on the right · <b>L</b> = back to lobby`;
  document.body.appendChild(hint);
  const cleanupHint = () => hint.remove();
  renderer = new Renderer(document.getElementById('arena') as HTMLCanvasElement, assets);
  mountTunePanel(true);
  room.broadcast({ t: 'phase', phase: 'play' });

  const gen = ++loopGen;
  let last = performance.now();
  const helpers = makeLoopHelpers();

  const loop = (now: number): void => {
    if (gen !== loopGen || mode !== 'practice' || !world || !renderer || !room) { cleanupHint(); return; }
    const dt = Math.min(now - last, 50);
    last = now;
    helpers.applyInputs();
    const events = step(world, dt);
    renderer.addEvents(events, world);
    for (const e of events) playSfx(e);
    helpers.syncBombPhones(now);
    renderer.draw(world, dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 't' && mode !== 'lobby') {
    const panel = document.getElementById('tune');
    if (panel) panel.remove();
    else mountTunePanel(true);
  }
  if (e.key.toLowerCase() === 'l' && mode === 'practice') {
    mode = 'lobby';
    room?.broadcast({ t: 'phase', phase: 'lobby' });
    document.getElementById('tune')?.remove();
    void renderLobby();
  }
  if (e.key.toLowerCase() === 'b' && mode === 'practice' && world) {
    world.rules.bomb = !world.rules.bomb;
    if (!world.rules.bomb) world.bomb = idleBomb(); // also clears any carrier
    const b = document.getElementById('banner');
    if (b) b.textContent = world.rules.bomb ? '💣 PRACTICE BOMB INCOMING' : '🎯 PRACTICE ARENA';
  }
});

function renderList(): void {
  const list = document.getElementById('plist');
  if (!list || !room) return;
  const rows: string[] = [];
  for (const c of [...room.controllers.values()].sort((a, b) => a.slot - b.slot)) {
    rows.push(`
      <div style="display:flex;align-items:center;gap:14px;background:#131a3a;
                  border-radius:14px;padding:12px 16px;border-left:8px solid ${c.color};
                  opacity:${c.connected ? 1 : 0.4}">
        <div style="font-size:26px">👺</div>
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
    : `<div style="opacity:.4">No goblins yet — scan the code!</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// 30Hz harness refresh: move steer bars + flash taps without rebuilding DOM.
setInterval(() => {
  if (!room || mode !== 'lobby') return;
  for (const c of room.controllers.values()) {
    const bar = document.getElementById(`steer-${c.slot}`);
    if (bar) {
      const mx = c.move?.x ?? c.steer;
      const halfPct = Math.abs(mx) * 48;
      bar.style.width = `${Math.max(halfPct, 2)}%`;
      bar.style.left = mx < 0 ? `${50 - halfPct}%` : '50%';
    }
    const tap = document.getElementById(`tap-${c.slot}`);
    if (tap) tap.style.background = c.tap ? c.color : '#0b1026';
  }
}, 33);

boot();
