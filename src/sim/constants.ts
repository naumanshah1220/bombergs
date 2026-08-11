// Every gameplay tunable lives here — the single tuning surface.
// C is mutable on purpose: the host's ?tune=1 panel writes these live.

// Defaults tuned live on-device (Nauman, practice arena, Aug 10 2026).
export const C = {
  BASE_SPEED: 225,          // px/s walk speed at full stick deflection
  CARRIER_SPEED_MULT: 1.35, // bomb carrier moves faster, no ability
  TURN_RATE: 5.5,           // rad/s (bots' trolley-style steering)
  ICE_GRIP: 5.6,            // 1/s — how fast velocity chases intent (higher = snappier)
  STICK_GRIP_MULT: 1.8,     // joystick control bites harder — panic must not mean helpless
  PENGUIN_RADIUS: 16,       // px collision radius (smaller bird = bigger-feeling map)
  FLOE_RADIUS: 600,         // px initial floe radius — fills the screen height
  BOT_SPEED_MULT: 1.0,      // even footing with humans
} as const satisfies Record<string, number>;

export type Tunables = { -readonly [K in keyof typeof C]: number };
export const TUNE = C as Tunables;

export const FLOE_SCALE_X = 1.55;       // horizontal stretch: wide berg, thin side margins
export const FLOE_WOBBLE = 0.12;        // fraction of radius randomized per spoke
export const FLOE_SPOKES = 64;          // star-polygon resolution
export const FLOE_MIN_AREA_FRAC = 0.12; // floe never shrinks below this fraction
export const ARENA_W = 1920;            // world units; floe centered here
export const ARENA_H = 1240;            // floe diameter 1120 → thin water margins
