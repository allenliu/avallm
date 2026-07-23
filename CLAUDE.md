# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AvaLLM — a web implementation of The Resistance: Avalon where the other players are LLM-powered bots (each openly labeled with its model). Authoritative Node server + React client, with a headless simulator for API-free development.

## Commands

```
npm test                                   # all tests (node:test, no API key or network needed)
node --test test/rules.test.ts             # a single test file
npm run sim -- --players 7 --seed 42       # one headless heuristic game, full transcript
npm run sim -- --games 200 --talk 0,0      # aggregate win-rate stats
npm run sim -- --agents llm --players 5    # headless game with real LLM calls + cost breakdown
npm run play                               # terminal play vs heuristic bots

npm --prefix client install                # client deps (one-time)
npm --prefix client run build              # build client into client/dist
npm --prefix client run dev                # vite build --watch (NOT a dev server — see below)

node server/server.ts                      # serve at http://localhost:8787
```

- **Server requires Node ≥ 24** and runs TypeScript natively — there is no server build step, no server `node_modules`, and it must stay **zero-dependency** (plain `node:http`). Only the client has npm dependencies.
- There is no Vite dev server: the game server serves the static `client/dist`, so client changes need a build (or the `--watch` variant) to show up. `.claude/launch.json` defines the `avalon` preview config (port 8787, autoPort).
- Config comes from a `.env` found by walking up from cwd (`server/llm/env.ts`); real env vars win. Keys: `OPENROUTER_API_KEY`, `OPENROUTER_MAX_SPEND_USD` (spend ceiling), `AVALON_INVITE_CODE` (gates money-spending/disk-writing routes on public deploys), `AVALON_PORT`/`PORT`.

## Architecture

Layering (details in `docs/design-implementation.md` §1; rules reference in `docs/research-rules-and-visuals.md`):

- `server/engine/` — **pure deterministic game logic**: event-sourced (`game.log` is the record; per-seat views derive from it), seeded PRNG, no I/O, no LLM, no `Date.now`. All rules live here and run headless under `node:test`.
- `server/agents/` — the plugin boundary. Every agent implements `decide(req: DecisionRequest, view: PlayerView): Promise<Decision>` (`server/agents/types.ts`). Built-ins: `llm`, `heuristic` (the forever-fallback), `random`, and `stdio` (external child processes speaking newline-delimited JSON — the AvalonBench bridge path). Invalid/illegal agent output degrades to the heuristic; it never stalls the game.
- `server/llm/` — the OpenRouter chokepoint: spend accounting + hard ceiling, per-model-family reasoning suppression, call-kind param table, model roster (`roster.ts` — `AgentSpec.model` is a roster id).
- `server/sim/` — headless drivers behind `npm run sim` / `npm run play`. Any table mix is simulatable at zero API cost because the engine never knows what kind of agent answered.
- `server/server.ts` — thin http glue: lobbies, in-memory games, per-seat SSE streams, static client. Seat identity is an opaque bearer token minted at join.
- `client/` — React/Vite; renders the human's `PlayerView` JSON and posts decisions.

### Invariants to preserve

- **Hidden information flows through one chokepoint**: `viewFor(game, seat)` in `server/engine/view.ts`. No prompt builder, client payload, or agent ever touches raw `Game` — they get a `PlayerView`. Contract tests `test/knowledge.test.ts` and `test/leaks.test.ts` pin this; new `PlayerView` fields are private-by-default for spectators (opt-in public in `viewForSpectator`).
- **The OpenRouter key and bot prompts never reach the browser.** The server owns all state and prompt construction; the client sees only the human's filtered view.
- **Player names are untrusted input** — they pass through sanitization plus a reserved-name policy (`nameIsReserved` in `server/engine/rules.ts`) before being embedded in other players' prompts. Anything else user-authored that lands in a prompt needs the same treatment.
- Games live in memory; a restart ends running games (snapshot persistence is on the roadmap — `docs/ROADMAP.md`).

## Docs

`docs/design-implementation.md` is the architecture reference (kept current; cite sections when relevant). `docs/research-strategy.md` feeds the bot prompts. `docs/ROADMAP.md` tracks deferred work. The design borrows patterns from the sibling repo `C:\Users\liual\Claude Projects\datingsim` (OpenRouter client, snapshot versioning).
