// Phone sensor plumbing: devicemotion → smoothed gravity vector, plus a
// desktop sim mode (?sim=1) that synthesizes gravity from keyboard/slider so
// the whole steering pipeline (calibration included) runs unchanged.

import type { Vec3 } from '../shared/steer';

export type SensorSource = {
  /** Latest smoothed gravity vector (device coords). */
  gravity(): Vec3;
  /** True once real (or simulated) samples are flowing. */
  ready(): boolean;
  sim: boolean;
};

const EMA_ALPHA = 0.2;

/** iOS 13+ gates motion behind a permission prompt that must come from a tap. */
export async function requestMotionPermission(): Promise<boolean> {
  const dm = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  try {
    if (typeof dm.requestPermission === 'function') {
      return (await dm.requestPermission()) === 'granted';
    }
    return true; // Android / desktop: no prompt needed
  } catch {
    return false;
  }
}

export function startRealSensors(): SensorSource {
  const g: Vec3 = { x: 0, y: 0, z: 0 };
  let samples = 0;
  window.addEventListener('devicemotion', (ev) => {
    const a = ev.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    // Note: iOS and Android disagree on the sign of gravity; calibration
    // absorbs the constant offset, and steering only uses deltas.
    g.x = g.x * (1 - EMA_ALPHA) + a.x * EMA_ALPHA;
    g.y = g.y * (1 - EMA_ALPHA) + a.y * EMA_ALPHA;
    g.z = g.z * (1 - EMA_ALPHA) + a.z * EMA_ALPHA;
    samples++;
  });
  return { gravity: () => g, ready: () => samples > 5, sim: false };
}

/**
 * Sim mode: ← / → keys (or an on-screen slider the UI binds via setAngle)
 * roll a virtual phone. Space is handled by the UI as the action button.
 */
export function startSimSensors(): SensorSource & { setAngle(deg: number): void; angle(): number } {
  let deg = 0;
  const held = new Set<string>();
  window.addEventListener('keydown', (e) => held.add(e.key));
  window.addEventListener('keyup', (e) => held.delete(e.key));
  setInterval(() => {
    if (held.has('ArrowLeft')) deg = Math.max(-45, deg - 3);
    else if (held.has('ArrowRight')) deg = Math.min(45, deg + 3);
    else deg *= 0.85; // spring back to center like a relaxed wrist
  }, 33);
  return {
    gravity: () => {
      const r = (deg * Math.PI) / 180;
      return { x: Math.sin(r) * 9.81, y: Math.cos(r) * 9.81, z: 0 };
    },
    ready: () => true,
    sim: true,
    setAngle: (d: number) => { deg = d; },
    angle: () => deg,
  };
}
