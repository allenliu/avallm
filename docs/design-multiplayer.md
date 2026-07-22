# Multiplayer design

**Status:** design, 2026-07-22. Companion to [design-implementation.md](design-implementation.md)
(§8.8 records the original future-note this expands).

Goal: multiple humans at one table, mixed freely with bot agents. Flow the user asked for:
pick single/multi at setup → host creates a lobby → shares a URL → friends join → game starts
when everyone is ready.

## Why this is cheap for us

The single-player architecture already made the three expensive multiplayer decisions:

1. **Server-authoritative state.** No client ever holds the deal; the browser gets a filtered view.
2. **Per-seat views.** `viewFor(game, seat)` is the only read path — a second human is just a
   second seat the server renders a view for. Hidden information stays structural.
3. **Agent-per-seat decisions.** The pump loop asks "who owes a decision"; a human seat is one
   whose decision arrives over HTTP instead of an LLM call. The engine cannot tell the difference.

What's genuinely new: **identity** (which HTTP request speaks for which seat), the **lobby**
lifecycle, and a pump that waits on *several* humans at once.

## Identity: seat tokens, no accounts

Friends-over-a-URL doesn't need accounts. On joining a lobby the server issues an opaque
`playerToken` (crypto-random); the client stores it in `localStorage` keyed by lobby id. Every
game endpoint takes the token and resolves it to a seat:

- `GET /api/game/:id/events?token=…` → SSE stream of THAT seat's payload (`viewFor(seat)`,
  that seat's pending asks, acting list)
- `POST /api/game/:id/decide {token, decision}` → applied as that seat

Token = bearer secret = the seat's hidden role, so the join URL must NOT contain tokens (it names
the lobby only; each browser mints its own token on join). Refresh/reconnect is free: EventSource
reconnects, the server always sends a full payload on connect, and the token survives in
localStorage. The reveal endpoint stays gated on `gameOver`.

## Lobby lifecycle

```
POST /api/lobby {hostName, config}        → { lobbyId, playerToken, joinUrl }
GET  /api/lobby/:id/events?token=…        → SSE: { members, config, status }
POST /api/lobby/:id/join {name}           → { playerToken }        (status must be 'open')
POST /api/lobby/:id/ready {token, ready}
POST /api/lobby/:id/config {token, …}     → host only: playerCount, roles, bot table
POST /api/lobby/:id/start {token}         → host only, all members ready
```

Lobby state: `{ id, hostToken, config, members: [{token, name, ready}], status: 'open'|'started',
gameId? }`. The join URL is `/#/join/<lobbyId>` (client-side route — the server stays a static
file server + API). Join after start → error with a pointer to spectate (future).

On start: humans are assigned seats (v1: shuffled — seat order in Avalon matters only via leader
rotation, and shuffling avoids "host always seat 0" bias), remaining seats are filled from the
lobby's bot table (agent library ids, same as today). The lobby broadcasts `{status: 'started',
gameId}`; clients navigate into the game carrying their token. Bots need no seats reserved in the
lobby — the host's config just says which agents fill whatever's left.

**Single player becomes a degenerate lobby**: one member, auto-ready, auto-start. The current
`POST /api/game/new` remains as sugar over it (or is reimplemented on the lobby path) — one code
path, two entry points. The setup screen's single/multi choice is just "start now" vs "create
lobby and wait".

## Game-session changes (server)

```ts
interface Session {
  game: Game
  agents: Map<Seat, AvalonAgent>          // bot seats only
  humans: Map<Seat, { token: string; name: string; listeners: Set<Response> }>
  waiting: DecisionRequest[]              // now: ALL pending human asks, any seat
  …
}
```

- **Pump generalization** (the only logic change): today it stops when the next decision is
  seat 0's. New rule: each iteration, fan out all pending *bot* decisions as before; if any
  expected decisions belong to human seats, broadcast per-seat asks and return. Resume on any
  human POST. Simultaneous phases (vote, quest) already fan out — humans just answer in any
  order; sequential phases (discussion, propose) naturally serialize because `expectedDecisions`
  yields one request at a time.
- **Per-seat broadcast**: `broadcast()` renders `humanPayload(seat)` per human listener instead
  of one payload. `degradedSeqs`, `acting`, and `bots` stay common; `view`/`ask` are per-seat.
- **Human names** flow through the existing `names[]` mechanism (already built — the name field
  landed with the seat-0 fix).

The engine needs **zero changes**. Tests: a session-level test driving two scripted "humans"
over the HTTP surface (supertest-style against the node server, or factor the session store into
a testable module — preferred).

## Pacing, disconnects, AFK

- **v1: no timers.** Friends at a virtual table self-pace; the UI shows *who* the table is
  waiting on (we already have `acting` for bots — add `waitingOn: name[]` for humans) so social
  pressure does the work.
- **Disconnect ≠ gone**: SSE drop just means no listener; the seat still owns its decisions.
  The banner shows "waiting on X (disconnected)" if no listener is attached.
- **AFK escape hatch (v1.5)**: host action "hand seat to Autopilot" — permanently converts a
  human seat to the heuristic agent (the degrade machinery already exists per-decision; this
  makes it per-seat). Logged in the feed like autopilot chips, visible in the reveal.

## Table talk with several humans

v1 keeps the turn-based discussion the engine already has — humans get their turns in seat order
like everyone else, with the same pass/lean UI. That's stilted for humans (real tables talk over
each other), so the fast-follow is a **free-form interjection channel**: a `chat` event humans can
emit any time during a discussion phase (engine change: a non-turn public event type), rendered in
the feed and included in bot transcripts as table talk. Bots stay turn-based — which conveniently
rate-limits token spend. Out of v1 to keep the engine untouched.

## Deployment reality

- **LAN play works the day this ships**: share `http://<lan-ip>:8787/#/join/…`.
- **Internet play needs hosting** (Railway/Fly + a domain). That exposes the OpenRouter key to
  strangers' games, so a public deployment must port datingsim's invite-gate pattern (game
  creation gated on an invite code) on top of the existing spend ceiling. Config flag; off for
  local play.
- **Server restarts kill in-memory games** (same as today). Mitigation when it matters: the
  versioned-JSON-snapshot pattern from the design doc §1 — `Game` is already plain JSON;
  snapshot on every event append, restore on boot. Scheduled for MP2, not MP1.

## Phasing

- **MP1 — lobby + seats (1-2 days)**: seat tokens, lobby endpoints + SSE, join screen, ready-up,
  seat-shuffled start, per-seat game streams, waiting-on indicator, single-player as auto-lobby.
  Exit: two browsers play one game with bots filling the rest.
- **MP2 — resilience**: reconnect polish, AFK→Autopilot handoff, session snapshots/restore,
  spectator links (view-only stream: `viewFor` with a role-less pseudo-seat showing public info).
- **MP3 — table feel**: free-form human chat into bot transcripts, hosted deployment + invite
  gate, lobby chat, per-player career stats.

## Open questions (host preferences wanted)

1. **Seat arrangement**: v1 shuffles humans among seats. Worth host-controlled seating later?
2. **Ready semantics**: strict all-ready before host can start, or host can force-start with
   not-ready members (who join as themselves anyway)? Lean: all-ready, it's 2 clicks.
3. **Mid-game join**: out of scope (Avalon deals roles at start). Spectate is the answer — MP2.
4. **Turn timers**: leave off until real play shows AFK is a problem, or ship a host-config
   timer in MP1? Lean: off.
