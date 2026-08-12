// Every gameplay tunable lives here — the single tuning surface.
// C is mutable on purpose: the host's ?tune=1 panel writes these live.
// World units: 64px tiles (pack-native); the camera scales up to the screen.

export const C = {
  BASE_SPEED: 150,          // px/s walk speed at full stick deflection
  CARRIER_SPEED_MULT: 1.35, // bomb carrier moves faster, no ability
  TURN_RATE: 5.5,           // rad/s (bots' steering)
  ICE_GRIP: 5.6,            // 1/s — how fast velocity chases intent
  STICK_GRIP_MULT: 2.4,     // joystick control bites harder
  PENGUIN_RADIUS: 14,       // px collision radius
  BOT_SPEED_MULT: 1.0,      // even footing with humans
} as const satisfies Record<string, number>;

export type Tunables = { -readonly [K in keyof typeof C]: number };
export const TUNE = C as Tunables;

export const START_LIVES = 3;
export const MAX_LIVES = 5;
export const INVULN_MS = 2500;          // post-hit mercy window (flashing)
export const KNOCKBACK = 350;           // px/s impulse away from a blast
export const PICKUP_INTERVAL_MS = 6500; // spawn cadence while under the cap
export const MAX_PICKUPS = 3;
export const PICKUP_RADIUS = 20;        // touch distance

export const GRID_COLS = 26;
export const GRID_ROWS = 16;
export const ARENA_W = GRID_COLS * 64;  // 1664
export const ARENA_H = GRID_ROWS * 64;  // 1024
