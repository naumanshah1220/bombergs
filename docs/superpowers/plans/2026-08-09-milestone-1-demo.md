# Bombergs Milestone 1 (Playable Demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playable demo — PC arena + 1 phone + 3 bots: pairing, gyro steering, throw/dodge/ground-stick bomb loop, floe-breaking explosions, water elimination, first-to-3 stages with the Blink/Dash/Ice-Shield draft.

**Architecture:** One static Vite app with two HTML entries: `index.html` (host/arena — owns the authoritative 60Hz sim) and `controller.html` (phone — sensors in, state out). PeerJS WebRTC connects them (host peer id derived from a 4-letter room code; no game server). All game logic lives in pure, unit-testable modules under `src/sim/`; rendering and networking are thin shells around it.

**Tech Stack:** TypeScript, Vite (multi-page), Canvas 2D, PeerJS, `qrcode` (npm), Vitest, `@vitejs/plugin-basic-ssl` (HTTPS dev — phone sensors require a secure context).

## Global Constraints

- Static hosting only (itch.io zip + naumansjunkyard.com): no server code, PeerJS public broker for signaling.
- Phone UI is one screen, one action button; controller must work in `?sim=1` desktop mode (keyboard/slider) for development and bot-free testing.
- iOS: `DeviceOrientationEvent.requestPermission()` must be called from the calibration tap; no Vibration API on iOS — every haptic cue has an audio twin.
- All gameplay constants in `src/sim/constants.ts` (single tuning surface).
- Sim modules never import DOM/PeerJS/Canvas — pure functions + data, Vitest-covered.
- Player colors (8): `#FF5A5F #FFB400 #3DDC84 #29B6F6 #AB47BC #FF7043 #EC407A #8D6E63`.

## File Structure

```
Z:\General Claude\Bombergs
├── index.html                  # host entry
├── controller.html             # phone entry
├── vite.config.ts              # multi-page build + basic-ssl
├── src/
│   ├── shared/protocol.ts      # message types + room-code helpers (host+controller)
│   ├── shared/steer.ts         # gravity→steer math (pure)
│   ├── host/main.ts            # host boot: room, QR, lobby, loop
│   ├── host/net.ts             # PeerJS host: accept controllers, route messages
│   ├── host/render.ts          # Canvas 2D arena renderer (+ retro downscale toggle)
│   ├── host/audio.ts           # WebAudio SFX stubs (procedural blips ok for M1)
│   ├── controller/main.ts      # phone boot: join, calibrate, send input, show state
│   ├── controller/sensors.ts   # permission + devicemotion → gravity vector (+ sim mode)
│   ├── controller/ui.ts        # DOM states: join/calibrate/play/bomb/dead/draft
│   ├── sim/constants.ts        # every tunable number
│   ├── sim/world.ts            # World state, step(), trolley physics, water check
│   ├── sim/floe.ts             # floe polygon, contains(), breakChunk()
│   ├── sim/bomb.ts             # fuse, carrier, throw arc, land/stick, explode
│   ├── sim/abilities.ts        # blink/dash/shield + cooldowns
│   ├── sim/stage.ts            # stage/draft/score state machine (first-to-N)
│   └── sim/bots.ts             # bot steering + tap decisions
└── tests/                      # vitest specs mirroring src/sim + shared
```

---

### Task 1: Scaffold + protocol module

**Files:** Create `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `controller.html`, `src/shared/protocol.ts`, `tests/protocol.test.ts`, `.gitignore`, `.claude/launch.json`.

**Interfaces (Produces):**
```ts
// protocol.ts
export type C2H =
  | { t: 'hello'; name: string; reclaim?: string }        // reclaim = prior slotToken
  | { t: 'input'; steer: number; tap: boolean }            // steer ∈ [-1,1], 30Hz
  | { t: 'draftPick'; index: 0 | 1 | 2 };
export type H2C =
  | { t: 'welcome'; slot: number; color: string; slotToken: string }
  | { t: 'phase'; phase: 'lobby' | 'calibrate' | 'play' | 'draft' | 'gameover' }
  | { t: 'bomb'; carrying: boolean; fuseFrac: number }     // drives takeover UI + tick rate
  | { t: 'draftOffer'; options: AbilityId[] }
  | { t: 'status'; alive: boolean; placement?: number; score: number };
export type AbilityId = 'blink' | 'dash' | 'shield';
export const roomCode = (): string => /* 4 chars from A-Z minus I,O */;
export const hostPeerId = (code: string) => `bombergs-${code.toLowerCase()}`;
```

- [ ] `npm create vite` equivalent by hand: package.json (vite, typescript, peerjs, qrcode, vitest, @vitejs/plugin-basic-ssl), two-entry `build.rollupOptions.input`, `server: { host: true, https via basicSsl() }`.
- [ ] Write `protocol.ts` with the types above; `roomCode()` uses crypto.getRandomValues, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I/O confusion).
- [ ] Test: `roomCode()` length/alphabet; `hostPeerId('ABCD') === 'bombergs-abcd'`. Run `npx vitest run` → PASS.
- [ ] `.claude/launch.json`: `{ name: "bombergs", runtimeExecutable: "npm", runtimeArgs: ["run","dev"], port: 5173, url: "https://localhost:5173" }`.
- [ ] Commit `feat: scaffold vite two-page app + protocol`.

### Task 2: Steering math (pure) — the controller feel core

**Files:** Create `src/shared/steer.ts`, `tests/steer.test.ts`.

**Interfaces (Produces):**
```ts
export type Vec3 = { x: number; y: number; z: number };
export const rollFromGravity = (g: Vec3): number;          // atan2(g.x, g.y), radians
export const makeSteer = (calibRoll: number) => (g: Vec3) => number; // [-1,1]
// mapping: delta = wrapAngle(rollFromGravity(g) - calibRoll)
// deadzone 2°, full lock 40°, response curve delta^1.6 (fine control near center)
export const flatness = (g: Vec3): number;                 // |g.z|/|g| — 1 means phone flat
```

Design rule (from spec): we *prescribe the grip* — calibration UI tells the player to hold the phone upright-landscape like a steering wheel facing them; `flatness > 0.85` triggers a "lift your handlebar!" nudge instead of trying to steer a flat phone (gravity can't see rotation about the vertical axis).

- [ ] Write failing tests: neutral → 0; +40° roll → 1; −40° → −1; 1° inside deadzone → 0; monotonic between; wrapAngle handles ±180° seam; flatness(0,0,-9.8) = 1.
- [ ] Implement; run `npx vitest run` → PASS.
- [ ] Commit `feat: gravity→steer mapping with deadzone and response curve`.

### Task 3: Controller page — sensors, calibration, sim mode

**Files:** Create `src/controller/{main,sensors,ui}.ts`; flesh out `controller.html` (dark UI, big type, portrait-locked hint, `touch-action: none`).

**Interfaces:**
- Consumes `steer.ts`, `protocol.ts`.
- Produces controller URL contract: `controller.html?room=ABCD` (QR encodes this), `&sim=1` adds keyboard (←/→ = steer, Space = tap) + on-screen slider, no sensors needed.

Sensor flow (sensors.ts): start button tap → `DeviceOrientationEvent.requestPermission?.()` and `DeviceMotionEvent.requestPermission?.()` (iOS) → listen `devicemotion`, EMA-smooth `accelerationIncludingGravity` (α=0.2) into a gravity Vec3 → "hold your trolley and tap" captures `calibRoll`. Steer computed on-device, sent 30Hz as `{t:'input'}` (send tap edge-triggered, cleared each frame).

UI states (ui.ts): `join` (name + connecting spinner) → `calibrate` → `play` (color-filled screen, giant action button, steer debug bar) → reacts to `H2C` messages: `bomb` (black screen, bomb emoji-art, tick audio via WebAudio oscillator at rate `2+8*fuseFrac` Hz, `navigator.vibrate?.(60)` per tick) / `draftOffer` (three cards) / `status` dead (frost overlay + placement).

- [ ] Build sensors.ts with sim-mode branch; ui.ts state machine; main.ts wires PeerJS `connect(hostPeerId(room))`.
- [ ] Manual verify (desktop): open `controller.html?room=TEST&sim=1` — slider moves debug bar; no console errors. (Host connection tested in Task 4.)
- [ ] Commit `feat: phone controller with calibration, sensors, sim mode`.

### Task 4: Host net + lobby + controller test harness

**Files:** Create `src/host/{main,net}.ts`; flesh out `index.html`.

**Interfaces:**
- net.ts produces: `createRoom(onJoin, onInput, onLeave): { code, sendTo(slot, msg: H2C), broadcast(msg) }`, slot assignment 0–7, slotToken = random 8 hex for reclaim.
- main.ts lobby screen: big room code, QR (`qrcode` npm → canvas) of `location.origin + '/controller.html?room=' + code`, list of joined penguins (name + color), **live steer bar + tap flash per controller** — this is the controller-settings harness the demo starts from. "Start" begins calibration phase then play.

- [ ] Implement net.ts (PeerJS `new Peer(hostPeerId(code))`, handle `connection`, route messages, heartbeat-drop after 5s silence).
- [ ] Implement lobby render (plain DOM for M1 lobby; canvas begins at play phase).
- [ ] Manual verify: two browser tabs — host tab shows code+QR; `controller.html?room=<code>&sim=1` tab joins, name appears, slider moves the host's steer bar live, Space flashes tap. Latency feels instant.
- [ ] Commit `feat: host room, QR pairing, live controller harness`.

### Task 5: Sim core — trolleys on ice, floe, water

**Files:** Create `src/sim/{constants,world,floe}.ts`, `tests/{world,floe}.test.ts`.

**Interfaces (Produces):**
```ts
// world.ts
export type Penguin = { slot: number; pos: Vec2; heading: number; vel: Vec2;
  alive: boolean; steer: number; speedMult: number; ability?: AbilityState };
export type World = { penguins: Penguin[]; floe: Floe; bomb: BombState; tick: number };
export const step = (w: World, dtMs: number): WorldEvent[];  // mutates w, returns events
export type WorldEvent = { kind: 'splash'|'explode'|'stick'|'throw'|'eliminated'; slot?: number; at?: Vec2 };
// physics: heading += steer * TURN_RATE * speedMult * dt
//          thrust along heading at BASE_SPEED * speedMult; vel = lerp(vel, thrust, ICE_GRIP*dt)
//          (drift = low ICE_GRIP); elastic pushout on penguin-penguin overlap
// floe.ts
export type Floe = { verts: Vec2[] };                         // convex-ish polygon
export const makeFloe = (radius: number, wobble: number, n: number): Floe;
export const contains = (f: Floe, p: Vec2): boolean;          // ray-cast
export const breakChunk = (f: Floe, at: Vec2, r: number): Floe; // carve circle-ish bite, min area guard
```
Constants (constants.ts, initial feel values): `BASE_SPEED 140 px/s`, `CARRIER_SPEED_MULT 1.15`, `TURN_RATE 2.6 rad/s`, `ICE_GRIP 3.0`, `PENGUIN_RADIUS 16`, `FLOE_RADIUS 340`, `FLOE_MIN_AREA_FRAC 0.12`.

- [ ] Tests first: straight-line travel distance; steer=1 curves left-vs-right symmetric; penguin outside `contains` → 'splash'+'eliminated' event and `alive=false`; `breakChunk` reduces area, never below min-area guard; two overlapping penguins separate.
- [ ] Implement; `npx vitest run` → PASS.
- [ ] Commit `feat: ice physics, floe polygon, water elimination`.

### Task 6: Arena renderer + game loop + retro toggle

**Files:** Create `src/host/render.ts`; modify `src/host/main.ts` (play phase: 60Hz `step`, render, input plumb from net).

Renderer draws (all procedural): dusk sky gradient + 3 aurora sine-ribbons (hue-shifting, additive), teal water, floe (white fill, blue rim, crack lines from `breakChunk` history), penguins (body ellipse, belly, scarf in slot color, bobble hat, trolley = 2 rects + 2 wheel circles under them), boost/ability trails, landing shadows, HUD: stage banner + score strip. **Retro toggle:** key `P` on host flips `renderScale` between 1 and 0.25 with `imageSmoothingEnabled=false` upscale — the pixel-art A/B we owe the user.

- [ ] Implement render.ts + loop; 4 keyboard-driven debug penguins (host keys) if no controllers.
- [ ] Manual verify in preview browser: floe + penguins render, movement drifts pleasingly, `P` toggles pixel look, 60fps in devtools perf.
- [ ] Commit `feat: arena renderer with aurora, trolley penguins, retro toggle`.

### Task 7: Bomb loop

**Files:** Create `src/sim/bomb.ts`, `tests/bomb.test.ts`; modify `world.ts` step to call bomb update; modify host main/render (skua sprite-blob, bomb + fuse spark, pass-radius ring, arc + shadow); controller gets `{t:'bomb'}` updates.

**Interfaces (Produces):**
```ts
export type BombState =
  | { s: 'delivering'; toSlot: number; t: number }            // skua flight 2s
  | { s: 'carried'; slot: number; fuseMs: number; fuseTotal: number; noTagBack?: { slot: number; ms: number } }
  | { s: 'flying'; from: number; toPos: Vec2; t01: number; fuseMs: number }   // 500ms arc
  | { s: 'ground'; pos: Vec2; fuseMs: number }
  | { s: 'none' };
export const tryThrow = (w: World): boolean;                  // carrier tap: nearest target in PASS_RADIUS(120), aims at their current pos
export const bombStep = (w: World, dt: number): WorldEvent[]; // fuse burn (15–25s random), land→stick if any penguin within STICK_RADIUS(22) else ground; ground touch → stick (thrower included); explode → eliminate carrier / BLAST_RADIUS(70) on ground+air, breakChunk, 'explode' event
```

- [ ] Tests: fuse expiry while carried eliminates carrier; throw at target who moved → ground; ground touch sticks to toucher incl. thrower; noTagBack blocks re-stick for 1500ms; ground explosion eliminates within blast radius only; explosion calls breakChunk at site.
- [ ] Implement + wire rendering (fuse spark rate & red pulse scale with `1-fuseFrac`) and `{t:'bomb'}` messages (send on change + 4Hz while carrying).
- [ ] Manual verify: harness tab + debug penguins — full chase/throw/dodge/boom loop feels right; carrier sim-controller tab shows takeover + audible tick.
- [ ] Commit `feat: bomb delivery, throw-to-stick, explosions break the floe`.

### Task 8: Stages, scoring, draft, abilities, bots

**Files:** Create `src/sim/{stage,abilities,bots}.ts`, `tests/{stage,abilities}.test.ts`; modify host main (phase machine), controller ui (draft cards).

**Interfaces (Produces):**
```ts
// stage.ts — pure reducer over phases: lobby → calibrate → play → stageEnd → draft(15s) → play … → gameover
export type Match = { targetPoints: number; scores: number[]; stageNo: number; phase: Phase };
export const onElimination = (m: Match, aliveCount: number): 'continue' | 'stageWon';
export const draftOffersFor = (m: Match, eliminationOrder: number[]): AbilityId[][]; // 3 of pool, earliest-out picks first (offers sent in that order)
// abilities.ts
export type AbilityState = { id: AbilityId; cooldownMs: number };
export const useAbility = (w: World, slot: number): boolean;   // blink: random pos within 180px kept on floe (may be NEAR edge — gamble per spec, but never in water); dash: vel += heading*420; shield: 2s bubble, redirect landing bomb to nearest other penguin
// cooldowns: blink 8000, dash 4000, shield 10000; carrier cannot use (spec)
// bots.ts
export const botInputs = (w: World, slot: number): { steer: number; tap: boolean };
// carrier bot: steer toward nearest target, tap when tryThrow would succeed
// runner bot: flee carrier (weight 2) + avoid edge (weight 3, sample ahead 40px) + wander; tap ability when carrier within 150px (dash/blink) or bomb flying at self (shield)
```

- [ ] Tests: first-to-3 ends match; draft order = elimination order (earliest first, winner last); blink never lands in water; shield redirects; cooldown gates spam; carrier blocked from ability use.
- [ ] Implement; wire draft UI on controller (3 cards, 15s auto-pick), stage banners on host, bots fill to 4 players.
- [ ] Manual verify: play a full first-to-3 match solo vs 3 bots in sim mode — stages, drafts, abilities, winner podium text.
- [ ] Commit `feat: stage machine, ability draft, blink/dash/shield, bots`.

### Task 9: Audio + juice + phone verification pass

**Files:** Create `src/host/audio.ts`; touch render.ts (screenshake on explode, confetti+fish particles, splash rings), controller ui (audio tick polish, dead-state frost).

- [ ] Procedural WebAudio: explosion (noise burst + lowpass sweep), splash (filtered noise), honk (square blip), tick (controller-side). Volume ramp on fuse.
- [ ] Juice: 250ms screenshake amplitude ∝ blast, particles, round banner tween.
- [ ] Real-phone verification (needs user's phone): HTTPS LAN URL, iOS permission flow, calibration grip, steering feel; tune `TURN_RATE`/deadzone/curve live via `?tune=1` panel on host exposing constants as sliders.
- [ ] Commit `feat: audio, juice, tuning panel`.

## Self-review notes

Spec coverage for M1 scope confirmed: pairing/QR (T4), gyro+calibration (T2/T3), throw/dodge/ground-stick + no-tag-backs + aerial/ground blasts (T7), floe breaking + min size + water elimination (T5/T7), carrier speed/no-ability asymmetry (T5/T8), first-to-N + draft order catch-up + 15s timer (T8), phone bomb takeover with audio-twin rule (T3/T7), retro toggle A/B (T6), bots for solo demo (T8), reconnect: slotToken produced in T1/T4 (full reclaim flow is M2 per spec — only token plumbing here). Deferred to M2 (per spec): modifiers, extra abilities, 8-phone scale test, publish pipeline.
