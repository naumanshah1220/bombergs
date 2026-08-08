# BOMBERGS — Design Spec

*Working title. Date: 2026-08-08. Status: awaiting final sign-off before implementation.*

## Concept

Penguins in runaway shopping trolleys play pass-the-bomb on a shrinking ice floe.
The PC/TV browser is the arena; each player's phone is their controller (gyro
steering, one action button) and their private screen (bomb panic state, ability
draft). 2–8 players, bots fill empty seats. Inspired by Netflix's Unhinged
(phone as diegetic object) and the Dota 2 / WC3 "Pass the Bomb" custom game
(toss + blink + vision-reduction modes).

**Purpose:** portfolio prototype for a Netflix technical game design application.
Must be publishable as static HTML5 (itch.io + naumansjunkyard.com), immaculately
intuitive, and demo-able solo (bots).

## Match structure

- A **match** is a series of **stages**. A stage is one full elimination round:
  bomb explosions eliminate penguins one by one until one remains — the stage
  winner earns **1 point**. First to **N points wins the match** (lobby setting,
  default 10; demo default 3).
- **Stage 1:** normal speed, no fog of war, no abilities. Pure steering + throwing.
- **After every stage:** every player (including eliminated ones) drafts
  **one ability from 3 offers** on their own phone. Earliest-eliminated players
  pick first (catch-up). 15s timer; timeout = random pick. Only the drafted
  ability is usable in the next stage; drafting a new one replaces the old.
- **Stage 3+:** global modifiers layer in (see Modifiers). One modifier at
  stages 3–4, two from stage 5 on, escalating speed multipliers.
- The floe resets to full size at each stage start.

## Core mechanics

### Movement
- Trolleys **always move forward**; players only steer (phone roll axis, held
  two-handed like a trolley handle). Neutral grip captured at stage start
  ("grab your trolley!" calibration moment).
- Ice physics: low friction, momentum, drift. Trolley-vs-trolley collisions are
  gentle elastic bumps (bumping is NOT how the bomb passes).
- Driving off the floe edge into water = elimination (splash, penguin floats by
  frozen in an ice cube as a spectator).

### The bomb
- Classic cartoon bomb: black sphere, lit fuse. The fuse is the only timer —
  it visibly burns down, sparking and beeping faster near the end; the bomb
  pulses red. Fuse length randomized ~15–25s per life.
- **Carrier state:** +15% move speed, no ability use. The carrier's phone
  becomes the bomb: bomb graphic, accelerating tick from the phone speaker,
  escalating vibration (Android; iOS gets louder audio — no vibration API).
- **Delivery:** a skua bird flies in and drops the bomb on a random living
  penguin at stage start and after any unclaimed ground explosion.

### Passing (throw-to-stick)
- The carrier projects a visible **pass radius** (red ring on the ice).
  Penguins inside it are highlighted as valid targets.
- **Tap = throw** at the nearest highlighted target. The bomb arcs ~0.5s
  through the air with a landing-shadow telegraph.
- **It must land to stick.** If the target moves/dashes/blinks off the shadow,
  the bomb lands on the ice, keeps burning, and **sticks to the first penguin
  that touches it — including the thrower**.
- 1.5s no-tag-backs: a fresh carrier can't be re-targeted by the previous
  carrier for 1.5s (prevents instant ping-pong at point-blank).
- In-flight fuse expiry → aerial explosion at current position (blast radius
  applies, no guaranteed elimination).

### Explosion
- Bomb explodes on fuse end: the carrier (or anyone within the blast radius of
  a ground/aerial explosion) is launched skyward and eliminated.
- The explosion **breaks that chunk off the floe** — arena shrinkage is scar
  tissue from deaths, not a timer. Cracks radiate from the blast site.
- Edge cases: carrier drowns → bomb sinks, skua redelivers after 2s. Everyone
  remaining dies in one blast → no point awarded, proceed to next stage.
  Floe has a minimum size (final-duel slab).

## Abilities (drafted, cooldown-based)

One ability per player per stage; single action button on the phone showing the
icon and a radial cooldown. Pool (demo set marked ★):

| Ability | Effect | Cooldown |
|---|---|---|
| ★ Blink | Teleport to a random spot within a medium radius (escape AND gamble — can land near the edge) | 8s |
| ★ Dash | Short speed burst in facing direction | 4s |
| ★ Ice Shield | 2s bubble; a bomb landing on you ricochets to the nearest other penguin | 10s |
| Decoy | Drop an inflatable penguin that counts as a throw target and pops on hit | 10s |
| Swap | Trade positions with a random living penguin | 12s |
| Snow Cannon | Cone knockback push (shove others toward edges / out of pass radius) | 6s |

Balance intent: cooldowns prevent spam; the carrier can't use abilities, so
drafting is about escape/denial, not offense while holding the bomb.

## Global modifiers (stage 3+)

- **Fog of War / Night:** floe goes dark; each trolley has a headlamp cone +
  small glow. Vision = union of all players' light on the shared screen.
  Penguins stay faintly visible; the floe edge, cracks, ground bombs and
  landing shadows are hidden outside lit areas. (Shared-screen adaptation of
  Dota's "Darkest of Nights".)
- **Blizzard banks:** drifting snow squalls hide penguins inside them
  (faint silhouette only) — hides *actors* where Night hides *the world*.
- **Speed frenzy:** global 2x (later 3x) move speed.
- **Wind:** periodic gusts with a visible warning (direction streaks + horn),
  pushing all trolleys off course for ~3s.
- **Super Toss:** pass radius doubled (long-bomb snipes, more dodges).
- **Double Bomb:** with 5+ alive, two bombs in play.

Modifier schedule: none (stages 1–2), one random (3–4), two random (5+).

## Presentation

- **Art (procedural-first, color problem solved deliberately):** dusk sky with
  animated aurora curtains (green/purple/pink); warm sunset tint on the ice;
  teal water with aurora reflections. Each penguin: saturated scarf + bobble
  hat + matching trolley (8 vivid player colors, mirrored on phones). A tacky
  neon "Arctic Mart" sign on a distant berg explains the trolleys; fish crates
  and traffic cones as bumpable props. Confetti-and-fish explosion bursts,
  colored boost trails. All Canvas 2D shapes — penguins are blobs with scarves;
  no sprite assets required. AI image gen only for title art (halftone-filtered
  for style unity).
- **Audio:** PC carries music + ambience (jaunty loop, squawks, honks,
  explosions, splashes — freesound/ElevenLabs SFX). Phone carries only the
  bomb tick and its own UI blips (the Unhinged audio split).
- **PC screen:** top-down arena, round banners ("STAGE 3 — NIGHT FALLS"),
  score strip (points toward N), winner podium + confetti.
- **Phone screens/states:** join & color confirm → calibration → play
  (steer + action button) → BOMB TAKEOVER → eliminated/spectator ("you placed
  4th") → ability draft (1 of 3 cards) → match end.

## Technical design

- **Stack:** TypeScript + Vite + Canvas 2D. One static web app; route `/` is
  the PC arena/host, `/c/:room` is the phone controller. Publishable to
  itch.io (HTML5 zip) and naumansjunkyard.com. HTTPS required (iOS motion).
- **Networking:** PeerJS (WebRTC DataChannels) — PC hosts, shows QR code with
  join URL + room code; phones connect P2P over LAN via PeerJS's free broker.
  No game server. Reconnect: controller rejoins with the same room code and
  reclaims its slot (penguin idles as bot while disconnected).
- **Authority:** PC simulates everything at 60Hz. Phones send `{tilt, tap}` at
  ~30Hz; PC sends phones only state changes (you-have-bomb, cooldown, draft
  offers, elimination, haptic cues). Latency budget <50ms LAN; steering is
  rate-based (tilt = turn rate), which is latency-tolerant vs. absolute
  pointing.
- **Phone sensors:** DeviceOrientation roll for steering; iOS 13+ permission
  prompt folded into the "grab your trolley" calibration tap. No vibration on
  iOS Safari → every haptic cue has an audio twin.
- **Bots:** fill to 4 minimum. Carrier bot seeks nearest target and throws when
  the radius highlights; others flee the carrier, avoid edges, use abilities on
  simple heuristics. Bots make the game solo-demo-able (recruiter-friendly).

## Milestones

1. **Playable demo:** PC arena + 1 phone + 3 bots. Pairing, calibrated gyro
   steering, throw/dodge/ground-stick, fuse explosion + floe breaking, water
   elimination, stage win, phone bomb-takeover, first-to-3 scoring with the
   ★ draft set (Blink/Dash/Ice Shield) from stage 2.
2. **Full game:** up to 8 phones, full ability pool, modifier system (Night,
   Blizzard, Speed, Wind, Super Toss, Double Bomb), polish pass (aurora,
   podium, SFX/music), reconnect handling, publish to itch.io + junkyard.
3. **Stretch:** lobby settings (points target, modifier toggles), spectator
   antics for eliminated players, second game on the same engine (card game).

## Cut list (explicitly not building)

UE5 version (documented as a port note in the GDD instead), real-time voice,
online (non-LAN) play, accounts/persistence, native apps, 3D rendering.
