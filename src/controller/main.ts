// Controller entry: join room → calibrate → stream input at 30Hz, render the
// state the host tells us to be in.

import Peer, { type DataConnection } from 'peerjs';
import { hostPeerId, type AbilityId, type C2H, type H2C } from '../shared/protocol';
import { FLAT_LIMIT, flatness, makeSteer, rollFromGravity } from '../shared/steer';
import { requestMotionPermission, startRealSensors, startSimSensors, type SensorSource } from './sensors';
import { ControllerUi, type DriveScheme } from './ui';

const params = new URLSearchParams(location.search);
const room = (params.get('room') ?? '').toUpperCase();
const simMode = params.get('sim') === '1';

const app = document.getElementById('app')!;
let conn: DataConnection | undefined;
let sensors: SensorSource | undefined;
let steerFn: ((g: { x: number; y: number; z: number }) => number) | undefined;
let tapHeld = false;
let tapQueued = false; // edge-trigger: guarantees short taps reach the host
let playerName = 'Penguin';
let carrying = false;
let lastOffer: AbilityId[] = [];
let myAbility: AbilityId | undefined;
// Joystick won the control-scheme bake-off (Aug 10 2026). The tilt (auto/gas)
// paths survive behind ?scheme=auto / ?scheme=gas for future experiments.
let scheme: DriveScheme = (params.get('scheme') as DriveScheme | null) ?? 'stick';
let gasHeld = false;
let moveVec = { x: 0, y: 0 };

/** Stick mode needs no gyro calibration — ready as soon as we're welcomed. */
const canDrive = (): boolean => scheme === 'stick' || steerFn !== undefined;

const ui = new ControllerUi(app, {
  onJoin(name) {
    playerName = name;
    send({ t: 'hello', name, reclaim: sessionStorage.getItem('bombergs-token') ?? undefined });
  },
  async onCalibrateTap() {
    if (simMode) {
      sensors = startSimSensors();
      ui.showSimSlider(() => (sensors as ReturnType<typeof startSimSensors>).angle());
    } else {
      if (!(await requestMotionPermission())) {
        ui.showError('Motion access is needed to steer. Reload and allow motion & orientation.');
        return;
      }
      sensors ??= startRealSensors();
      await waitFor(() => sensors!.ready(), 1500);
    }
    // settle 400ms, then capture neutral grip
    await new Promise((r) => setTimeout(r, 400));
    steerFn = makeSteer(rollFromGravity(sensors!.gravity()));
    ui.showPlay(playerName, myAbility, scheme);
  },
  onAction(pressed) {
    if (pressed && !tapHeld) tapQueued = true;
    tapHeld = pressed;
  },
  onThrottle(pressed) {
    gasHeld = pressed;
  },
  onMove(x, y) {
    moveVec = { x, y };
  },
  onSchemeToggle() {
    scheme = scheme === 'auto' ? 'gas' : scheme === 'gas' ? 'stick' : 'auto';
    gasHeld = false;
    moveVec = { x: 0, y: 0 };
    // re-render whichever driving screen we're on
    if (carrying) ui.showBomb(scheme);
    else if (canDrive()) ui.showPlay(playerName, myAbility, scheme);
  },
  onDraftPick(index) {
    myAbility = lastOffer[index];
    send({ t: 'draftPick', index });
    ui.showWaiting('Ability locked in — next stage soon!');
  },
  onSimAngle(deg) {
    (sensors as ReturnType<typeof startSimSensors> | undefined)?.setAngle?.(deg);
  },
});

function send(msg: C2H): void {
  conn?.send(msg);
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => (cond() || Date.now() - t0 > timeoutMs ? resolve() : setTimeout(poll, 50));
    poll();
  });
}

function handleHostMessage(msg: H2C): void {
  switch (msg.t) {
    case 'welcome':
      ui.color = msg.color;
      sessionStorage.setItem('bombergs-token', msg.slotToken);
      if (scheme === 'stick') ui.showPlay(playerName, myAbility, scheme);
      else ui.showCalibrate(simMode);
      break;
    case 'phase':
      if (msg.phase === 'calibrate') ui.showCalibrate(simMode);
      // New stage: everyone returns to the sticks (revives the dead)
      if (msg.phase === 'play' && canDrive()) { carrying = false; ui.stopFuse(); ui.showPlay(playerName, myAbility, scheme); }
      if (msg.phase === 'play' && !canDrive()) ui.showCalibrate(simMode);
      if (msg.phase === 'gameover') ui.showWaiting('Match over! Check the big screen 🏆');
      if (msg.phase === 'lobby') ui.showWaiting('Back in the lobby — next match soon!');
      break;
    case 'bomb':
      if (msg.carrying && !carrying) ui.showBomb(scheme);
      if (!msg.carrying && carrying && canDrive()) { ui.stopFuse(); ui.showPlay(playerName, myAbility, scheme); }
      carrying = msg.carrying;
      if (carrying) ui.setFuse(msg.fuseFrac);
      break;
    case 'draftOffer':
      lastOffer = msg.options;
      ui.showDraft(msg.options);
      break;
    case 'status':
      if (!msg.alive && msg.placement) ui.showDead(msg.placement);
      break;
  }
}

function connect(): void {
  if (!room || room.length !== 4) {
    ui.showError('No room code. Scan the QR code on the TV to join.');
    return;
  }
  ui.showJoin(room, true);
  const peer = new Peer();
  peer.on('open', () => {
    conn = peer.connect(hostPeerId(room), { reliable: true });
    conn.on('open', () => ui.showJoin(room, false));
    conn.on('data', (d) => handleHostMessage(d as H2C));
    conn.on('close', () => ui.showError('Lost connection to the TV. Reload to rejoin.'));
  });
  peer.on('error', (err) => {
    ui.showError(err.type === 'peer-unavailable'
      ? `Room ${room} not found. Check the code on the TV.`
      : `Connection trouble (${err.type}). Reload to retry.`);
  });
}

// 30Hz input pump — also acts as the keepalive from the moment we connect,
// so the host never mistakes "still calibrating" for "walked away".
setInterval(() => {
  if (!conn?.open) return;
  let steer = 0;
  let flat = false;
  if (sensors && steerFn) {
    const g = sensors.gravity();
    steer = steerFn(g);
    flat = !sensors.sim && flatness(g) > FLAT_LIMIT;
    ui.updatePlay(steer, flat);
  }
  send({
    t: 'input',
    steer: flat ? 0 : steer,
    tap: tapQueued || tapHeld,
    throttle: scheme === 'gas' ? (gasHeld ? 1 : 0) : undefined,
    move: scheme === 'stick' ? moveVec : undefined,
  });
  tapQueued = false;
}, 20); // 50Hz — input latency budget matters more than bandwidth here

connect();
