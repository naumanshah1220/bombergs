// Every gameplay tunable lives here — the single tuning surface.

export const BASE_SPEED = 140;          // px/s forward thrust
export const CARRIER_SPEED_MULT = 1.15; // bomb carrier moves faster, no ability
export const TURN_RATE = 2.6;           // rad/s at full lock
export const ICE_GRIP = 3.0;            // 1/s — how fast velocity chases heading (low = drift)
export const PENGUIN_RADIUS = 16;       // px collision radius
export const FLOE_RADIUS = 340;         // px initial floe radius
export const FLOE_WOBBLE = 0.12;        // fraction of radius randomized per spoke
export const FLOE_SPOKES = 64;          // star-polygon resolution
export const FLOE_MIN_AREA_FRAC = 0.12; // floe never shrinks below this fraction
export const ARENA_W = 1280;            // world units; floe centered here
export const ARENA_H = 800;
