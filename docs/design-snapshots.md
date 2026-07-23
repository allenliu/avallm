# Design: session snapshots & restore

**Status:** scoped, unbuilt (ROADMAP #1). Written 2026-07-23.
Companions: [design-implementation.md](design-implementation.md) (architecture),
[design-multiplayer.md](design-multiplayer.md) (lobby/session model),
[ROADMAP.md](ROADMAP.md) (#1, and the "redeploy kills running games" ledger row).

## Why

Games live entirely in memory (`sessions`, `lobbies` maps in
[server/server.ts](../server/server.ts)). Every Railway redeploy, crash, or
process recycle destroys every running game and boots all players. That is
tolerable for a timer-based game but **fatal for this one**: play is
correspondence-paced with *no timers* (a deliberate identity choice —
ROADMAP "Deliberately not doing"), so a single game can legitimately span
hours or days waiting on human seats. A deploy mid-game today is silently
destructive.

The goal: **a restart resumes every in-progress game exactly where it left
off**, with the same seat tokens, the same bot configs, and the same private
history — and stops pressuring us to deploy only when no table is live.

This is durability for the state that already exists. It adds **no** timers, no
real-time behavior, and no change to the hidden-information model.

## What makes this cheap: the engine is already event-sourced

`Game` ([engine/types.ts](../server/engine/types.ts)) is plain JSON with no
methods, no `Date`, no live handles. `game.log` is the authoritative record;
every per-seat `PlayerView` derives from it via `viewFor`. So "snapshot a game"
is just `JSON.stringify(game)` — there is no mutable-object graph to walk. The
hard part (a single source of truth) is done.

The remaining work is entirely in the **server layer**, and must stay there:
the engine invariant is *pure, no I/O, no Date.now* — persistence must never be
added inside `applyDecision` or the engine. The server's `pump` loop is the
chokepoint that owns the side effect.

## Anatomy of a Session — what persists, what rebuilds, what's dropped

The `Session` interface (server.ts:347) already separates these cleanly. Note
`agentDefs` was deep-copied at game start *specifically* for this feature —
see the comment at server.ts:298 ("later, session snapshots must serve the
config that actually played").

| Field | Disposition | Why |
|---|---|---|
| `game: Game` | **persist** | The whole record. Plain JSON already. |
| `humans: Map<Seat,{token,name}>` | **persist** (as entries array) | Bearer tokens *are* seat identity — a player reconnects by presenting the same token to `/valid` and the SSE stream. Lose these and every human is locked out of their own game. |
| `spectators: Set<string>` | **persist** (as array) | Spectator tokens; same reconnection story. |
| `botInfo: Record<seat,AgentPublicInfo>` | **persist** | Display badges (name/model/color) captured at start with game-specific deduped names. Cheap; avoids recompute drift. |
| `agentDefs: Record<seat,{def,model}>` | **persist** | The def snapshots + seat model overrides taken at start. Agents are rebuilt from these. Already deep-copied so a mid-game PUT/DELETE can't mutate a running game. |
| `degraded`, `degradedSeqs` | **persist** | Fallback annotations shown in the feed and reveal — part of the record. |
| `agents: Map<Seat,AvalonAgent>` | **rebuild** | Live agent objects (may hold LLM client closures). Not serializable, not needed: reconstruct via `createAgentFromDef(def, {seed, seat}, model)` from `agentDefs`. |
| `waiting`, `acting` | **rebuild** | Transient decision-queue projection; recompute from `expectedDecisions(game)` on resume. Persisting risks resurrecting stale in-flight state. |
| `listeners: Set<{res,token}>` | **drop** | Live SSE HTTP responses. Empty on restore; clients reconnect and re-subscribe. |
| `pumping: boolean` | **drop** | In-process re-entrancy lock. Always `false` on restore. |

**Lobbies** (`Lobby`, server.ts:172): persist `open` lobbies too (minus
`listeners`), so a redeploy during lobby-fill doesn't strand invitees holding a
join URL. `started` lobbies just carry a `gameId` pointer — keep it so the
lobby→game handoff survives.

## When to write — write-through at the pump chokepoint

The engine appends events; the server reacts. Every state mutation in a live
game already funnels through a `broadcast(s)` call in `pump` (server.ts:437)
and in the human-decision / rename / join handlers. That is the natural place
to persist:

- After each `applyDecision` in the pump loop (server.ts:425), and after every
  other `broadcast(s)`, call `persistSession(s)`.
- **Write-through, one event of lag at most.** The persisted state never trails
  the in-memory game by more than a single event, and re-deriving from `log` is
  always safe, so even a crash between apply and write costs at most a replay of
  one bot turn.
- At friends-scale a full `JSON.stringify(game)` per event is negligible
  (games are kilobytes; writes are atomic temp+rename). If profiling ever shows
  I/O on the hot path, debounce with a dirty flag — but start simple and
  correct, matching the ROADMAP's "on every event append."

Do **not** thread persistence into the engine. `persistSession` lives beside
`broadcast`, in the server.

## Where to write — extend the data-dir plumbing already in place

The custom-agents persistence work
([defs.ts](../server/agents/defs.ts) `useDataDir` / `userAgentsDir`, resolved
once at startup from `AVALON_DATA_DIR` → `RAILWAY_VOLUME_MOUNT_PATH` → repo
`./data`) is the foundation. Generalize it to a shared data root:

```
<dataDir>/agents/<id>.json      # existing: custom agent library
<dataDir>/sessions/<id>.json    # new: one file per game session
<dataDir>/lobbies/<id>.json     # new: open lobbies
<dataDir>/spend.json            # new: durable spend counter (below)
```

Factor the resolved base into a single `dataDir()` the session store and the
agent store both read (today only `userAgentsDir()` consumes it). Same Railway
volume, same single-instance assumption (a volume attaches to one instance —
snapshots, like the volume, assume no horizontal scaling; note it, don't
solve it).

## Restore on boot

After `loadEnv` + `useDataDir` + `reloadLibrary` in server startup, add
`restoreSessions()` / `restoreLobbies()`:

1. Read `<dataDir>/sessions/*.json`. For each, rehydrate the `Session`:
   rebuild `agents` from `agentDefs`, recompute `waiting`/`acting` from
   `expectedDecisions(game)`, set `listeners` empty and `pumping` false.
2. Re-insert into the `sessions` map under its id.
3. For any session not `gameOver`, kick `void pump(session)` so bot turns that
   were pending at crash time resume immediately.
4. **A corrupt or version-mismatched snapshot must never crash boot.** Wrap
   each file load in try/catch and surface it as a problem (exactly the pattern
   `loadTier` already uses for agent files) — skip the bad session, keep the
   rest.

## Reconnection is nearly free

Because tokens persist and views derive from `log`, a restart is just "all SSE
listeners dropped at once" — which is already a supported state (any client can
drop and reconnect). A returning human's saved bearer token still passes
`/valid`; their EventSource reconnects and `payloadFor` hands back a fresh
snapshot of the exact current state. No new client work, no replay protocol.

## Crash semantics

- **Died mid-pump, before `applyDecision`:** the event was never appended, so
  on resume `expectedDecisions` re-asks that seat. Idempotent for game state;
  costs one duplicate LLM call (acceptable).
- **Died after `applyDecision`, before the write:** at most one event of lag;
  resume re-derives from `log` and continues. No corruption.
- **Atomic writes:** reuse the temp-file + `rename` pattern from `saveCustomDef`
  (already commented re: "a Railway redeploy mid-write must not leave truncated
  JSON"). Factor a shared `writeJsonAtomic(file, obj)` so agents, sessions, and
  spend all get the same crash-safety. Same-dir tmp → rename is atomic on one
  filesystem.

## Spend counter durability (the second half of ROADMAP #1)

The `OPENROUTER_MAX_SPEND_USD` ceiling is enforced against an in-process
`SPEND` closure in [openrouter.ts](../server/llm/openrouter.ts) that **resets
every process** — so today the only durable budget cap is OpenRouter's own
key-level limit. Persist it:

- Seed `SPEND` from `<dataDir>/spend.json` in `createOpenRouter`.
- Write-through (debounced) in `recordSpend`.
- Single process ⇒ no locking needed.

This makes the ceiling cumulative across redeploys, which is the point of a
budget cap. Persisting the full per-tag map (not just the total) also feeds the
future usage dashboard (ROADMAP #3).

## Retention / GC

`gameOver` sessions are kept for the post-game reveal (players revisit), so
they can't be deleted at end-of-game — but they accumulate. Recommend:

- Derive `finishedAt` from the `gameOver` event; GC session files older than a
  retention window (e.g. 7 days) on boot.
- GC abandoned `open` lobbies (no members, or stale) on boot.

## Schema versioning

Wrap every persisted file in an envelope with a `snapshotVersion`. On load,
mismatch ⇒ migrate if cheap, else log-and-skip (never crash). Borrow the
snapshot-versioning pattern from the sibling `datingsim` repo (noted in
CLAUDE.md). The load-boundary try/catch above is the safety net regardless.

## Testing

- **Round-trip unit:** serialize→deserialize a `Session`; assert `game`,
  `humans`, `spectators`, `agentDefs`, `degraded` preserved; assert `agents`
  reconstruct and can `decide`.
- **Restart integration:** drive a game partway, snapshot, construct a fresh
  server over the same data dir; assert a human token still `/valid`s, SSE
  resumes, and bots pump through to `gameOver`.
- **Crash-mid-pump:** simulate death between `decide` and `applyDecision`;
  assert resume re-asks and completes with no state corruption.
- **Corrupt snapshot:** a garbage file in `sessions/` is skipped and surfaced,
  boot succeeds, other sessions load.
- **Engine purity guard:** confirm no I/O crept into the engine (the existing
  contract tests already pin purity).

## Phasing

All of these share the `dataDir()` + `writeJsonAtomic` plumbing, so land that
first, then:

1. **Sessions** — write-through + restore + resume pump. The high-value 80%.
2. **Spend counter** — small, independent, closes the second ledger row.
3. **Lobbies + GC + schema-version envelope** — polish.

## Open questions

- Per-event write vs. debounced? (Start per-event; revisit only if profiled.)
- Retention window length, and should finished games ever be user-deletable?
- Spend counter: cumulative-forever, or resettable per billing period?
- Multi-replica is explicitly out of scope (single-instance volume) — revisit
  only if the deployment ever scales horizontally.
