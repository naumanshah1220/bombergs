# 🧨 Bombergs

A local-multiplayer party game where **the screen is the arena and everyone's phone is a controller**. No app, no install, no accounts — open the page on a TV or laptop, everyone scans the QR code, and you're playing in about ten seconds.

2–8 goblins pass a lit bomb around a destructible island. Whoever is holding it when the fuse burns out loses a life. Three lives each, last goblin standing wins.

**▶︎ Play it:** _(link goes here once Pages finishes its first deploy)_

> Best with 3+ people in the same room. Solo? Hit **PRACTICE** to walk around, or **START** and the empty seats fill with bots.

---

## How it plays

- **Left thumb** walks, **right thumb** is the context button — throw when you have the bomb, ability when you don't.
- Throws **home in and stick**. The only way out is to fire an ability at the right moment, which makes the bomb fall short.
- The carrier moves **faster than everyone else**, so being "it" is dangerous rather than hopeless.
- Explosions **blow permanent holes** in the low ground, so the island shrinks all match. Plateaus, stairs, and the tiles around them survive — a crater at the foot of a staircase would turn it into a diving board.
- Fall in the water and you lose a life and respawn. Hearts and ability crates spawn on the map.

Press **T** during a match for live physics sliders. `?maker=1` opens a map editor with terrain painting, stairs, and decoration placement; saved maps show up in the lobby's level picker.

## Running it locally

```bash
npm install
npm run dev
```

Open the printed **Local** URL on the PC and scan the QR with a phone. `npm run dev` also opens a Cloudflare quick tunnel so phones can join from any network; the lobby's join-link picker lists every route it can offer, ranked fastest first. `NO_TUNNEL=1 npm run dev` skips it.

```bash
npm test          # 44 tests: sim, bomb loop, bot behaviour, protocol
npm run build     # static bundle into dist/
```

## How it works

The PC is the authoritative simulation: it runs the whole game at 60Hz and phones only ever send input. That keeps every phone a dumb terminal, so a laggy controller can't corrupt the match.

Getting input from a phone to the PC is the genuinely hard part, and there are two paths:

- **In development**, the dev server hosts a WebSocket relay (`/relay`). The phone already reached that origin to load the page, so a socket back to it always works — no NAT traversal, no STUN/TURN, no firewall rule.
- **When published as a static site** there is no server, so it falls back to **WebRTC via PeerJS**, whose defaults include TURN relays for phones that can't reach the PC directly.

Both ends speak the same tiny message protocol either way (`src/shared/protocol.ts`), so the game doesn't know or care which transport it got.

```
src/
  sim/         pure game logic — no DOM, no network, fully unit-tested
  host/        PC: renderer, lobby, map maker, asset pipeline
  controller/  phone: joystick UI, input pump
  shared/      protocol + transports used by both ends
```

## Credits

Built by [Nauman Shah](https://naumansjunkyard.com).

Art is the **Tiny Swords** pack by [Pixel Frog](https://pixelfrog-assets.itch.io/tiny-swords) — characters, terrain, buildings and effects, recoloured per player and re-sliced for a top-down view. The bomb-carry, throw and rolling-bomb spritesheets are hand-made for this project.
