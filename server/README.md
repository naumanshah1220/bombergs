# Bombergs relay

A ~60-line message relay: it routes JSON between the one **host** of a room
(the PC running the arena) and its **controllers** (phones), keyed by room
code. It never inspects payloads.

## Why this exists

Phones and the PC could talk directly over WebRTC, and in a perfect world
they would — it is peer-to-peer and needs no server. In practice a phone and
a PC usually cannot reach each other directly (NAT, router client isolation,
mDNS-obfuscated local candidates), and the standard fix is a TURN relay.

**Measured Aug 14 2026:** neither PeerJS's bundled TURN servers nor the
public Open Relay ones produce a single relay ICE candidate any more. With no
working TURN available for free, WebRTC cannot be relied on, and the game
falls back to a controller stuck on "Connecting…".

A WebSocket relay sidesteps all of it. The phone already reached a public
HTTPS origin to load the page, so a socket to a public origin always works:
no NAT traversal, no STUN/TURN, no firewall rules.

The dev server runs this same protocol at `/relay`, so local play needs
nothing deployed.

## Deploy it (Cloudflare Workers, free)

Durable Objects give one consistent instance per room, which is exactly the
routing model here.

Wrangler is already a dev dependency, so from the repo root:

```bash
cd server && npx wrangler login && npx wrangler deploy
```

`wrangler login` opens a browser once and stores the credential locally — no
token ever gets pasted anywhere.

Verified before deploying: `npx wrangler dev --local` runs this Worker with
no account at all, and the game pairs through it end to end.

**Deployed:** `wss://bombergs-relay.naumanshah1220.workers.dev`

### If the first deploy complains about a workers.dev subdomain

A brand-new Cloudflare account has none, and every Worker URL hangs off it.
Wrangler tries to claim one automatically using the **directory name it is
run from** — so deploying from a folder called `server` tries to claim
`server`, which has been taken for years, and the deploy stops.

Deploying once from a folder named after the subdomain you want claims it.
(The Worker itself is still named by `wrangler.toml`, not the folder.) The
error also links to a `/workers/onboarding` dashboard page that does not
exist; the real one is `/workers/subdomain`.

Wrangler prints a URL like `https://bombergs-relay.<you>.workers.dev`.

Then point the game at it. In the repo: **Settings → Secrets and variables →
Actions → Variables → New repository variable**

| Name             | Value                                           |
| ---------------- | ----------------------------------------------- |
| `VITE_RELAY_URL` | `wss://bombergs-relay.<you>.workers.dev`        |

Push (or re-run the deploy workflow) and published builds will use the relay,
with WebRTC still there as a fallback.

> `wss://`, not `https://` — it is a WebSocket endpoint.

## Protocol

Connect to `/relay?room=CODE&role=host` or `/relay?room=CODE&role=ctrl&id=ID`.

- controller → relay: the raw message. Relay → host: `{from, t:'msg', msg}`.
- host → relay: `{to, msg}`. Relay → that controller: `{t:'msg', msg}`.
- Controllers joining and leaving arrive at the host as `{from, t:'open'}`
  and `{from, t:'close'}`.
