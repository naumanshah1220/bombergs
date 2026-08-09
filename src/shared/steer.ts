// Gravity → steering math. Pure functions only (unit-tested, no DOM).
//
// Grip design: the calibration screen tells the player to hold the phone
// upright-landscape like a steering wheel facing them. In that grip, tilting
// the "handlebar" rotates gravity within the screen's x/y plane, so the roll
// angle is atan2(gx, gy) and no euler-angle gimbal cases apply. Gravity cannot
// see rotation about the vertical axis, so a flat (screen-up) phone can't
// steer — flatness() lets the UI nudge the player to lift the handlebar
// instead of silently failing.

export type Vec3 = { x: number; y: number; z: number };

export const DEADZONE_RAD = (2 * Math.PI) / 180;
export const FULL_LOCK_RAD = (40 * Math.PI) / 180;
export const RESPONSE_EXP = 1.6;
/** |g.z|/|g| above this = phone held flat; steering is unreliable. */
export const FLAT_LIMIT = 0.85;

/** Roll of the phone within the screen plane, radians. 0 = upright. */
export function rollFromGravity(g: Vec3): number {
  return Math.atan2(g.x, g.y);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** 1 = phone lying flat (screen up/down), 0 = phone upright. */
export function flatness(g: Vec3): number {
  const len = Math.hypot(g.x, g.y, g.z);
  return len === 0 ? 0 : Math.abs(g.z) / len;
}

/**
 * Build a steering function from a calibrated neutral roll.
 * Returns steer in [-1, 1]: deadzone 2°, full lock 40°, response curve ^1.6
 * for fine control near center.
 */
export function makeSteer(calibRoll: number): (g: Vec3) => number {
  return (g: Vec3) => {
    const delta = wrapAngle(rollFromGravity(g) - calibRoll);
    const mag = Math.abs(delta);
    if (mag < DEADZONE_RAD) return 0;
    const span = FULL_LOCK_RAD - DEADZONE_RAD;
    const norm = Math.min((mag - DEADZONE_RAD) / span, 1);
    return Math.sign(delta) * Math.pow(norm, RESPONSE_EXP);
  };
}
