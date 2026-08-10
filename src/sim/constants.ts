// Every gameplay tunable lives here — the single tuning surface.
// C is mutable on purpose: the host's ?tune=1 panel writes these live.

export const C = {
  BASE_SPEED: 130,          // px/s forward thrust — humans first, chaos later
  CARRIER_SPEED_MULT: 1.2,  // bomb carrier moves faster, no ability
  TURN_RATE: 3.6,           // rad/s at full lock
  ICE_GRIP: 4.2,            // 1/s — how fast velocity chases heading (low = drift)
  PENGUIN_RADIUS: 22,       // px collision radius
  FLOE_RADIUS: 560,         // px initial floe radius — nearly screen height
  BOT_SPEED_MULT: 0.85,     // bots are handicapped; humans must be able to win
} as const satisfies Record<string, number>;

export type Tunables = { -readonly [K in keyof typeof C]: number };
export const TUNE = C as Tunables;

export const FLOE_SCALE_X = 1.55;       // horizontal stretch: wide berg, thin side margins
export const FLOE_WOBBLE = 0.12;        // fraction of radius randomized per spoke
export const FLOE_SPOKES = 64;          // star-polygon resolution
export const FLOE_MIN_AREA_FRAC = 0.12; // floe never shrinks below this fraction
export const ARENA_W = 1920;            // world units; floe centered here
export const ARENA_H = 1240;            // floe diameter 1120 → thin water margins
