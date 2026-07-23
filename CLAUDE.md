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
- Config comes from a `.env` found by walking up from cwd (`server/llm/env.ts`); real env vars win. Keys: `OPENROUTER_API_KEY`, `OPENROUTER_MAX_SPEND_USD` (spend ceiling), `AVALON_INVITE_CODE` (gates money-spending/disk-writing routes on public deploys), `AVALON_PORT`/`PORT`, `AVALON_DATA_DIR` (parent dir for runtime-written user agents; defaults to `RAILWAY_VOLUME_MOUNT_PATH` then repo-local `./data` — point it at a mounted persistent disk so custom agents survive redeploys).

## Screenshot gallery (UI before/after)

`docs/screens/` holds committed screenshots of hard-to-reach UI states — setup variants,
every game phase, the Record/Codex sheets, the reveal, lobby host, join screen, and an
in-game spectator, at desktop 1280×800 and mobile 390×844. Expectations:

- **Regenerate when a commit visibly changes the client UI** (styles, layout, component
  markup), and include the refreshed images in that commit so reviewers get a before/after
  diff. Don't regenerate for non-visual changes — image churn drowns the signal.
- Command: `npm --prefix client run build && node tools/screenshots.mjs` (~3–4 min; spawns
  its own server on port 18917; Chrome at the default Windows path or `CHROME` env).
- Runs are **intentionally unseeded**: the seed determines the hidden role deal, so a
  client-chosen seed would be an information leak. Treat the gallery as a layout/design
  diff, not a pixel test — role names, chatter, and which optional states get captured
  (vote vs. propose) vary run to run.
- Puppeteer-core lives in `client/` devDependencies (the server stays zero-dependency).
- Known gap: no error/reconnect-banner capture yet.

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
- **The OpenRouter key and live-game bot prompts never reach the browser.** The server owns all state and prompt construction; the client sees only the human's filtered view of a real game. Deliberate exceptions, transparency-by-design (docs/design-custom-agents.md §4/§7): the static prompt anatomy (rules digest, baseline guidance, table-talk norms, output contracts) served by `GET /api/agents`, and fully rendered prompts for the fixed-seed FIXTURE game served by `POST /api/agents/preview` — neither can carry state from any live session.
- **Player names are untrusted input** — they pass through sanitization plus a reserved-name policy (`nameIsReserved` in `server/engine/rules.ts`) before being embedded in other players' prompts. Anything else user-authored that lands in a prompt needs the same treatment.
- Games live in memory; a restart ends running games (snapshot persistence is on the roadmap — `docs/ROADMAP.md`).

## Pushing vs. deploying

Railway tracks the `deploy` branch, not `master` — pushing `master` never triggers a deploy. Deploying means advancing `deploy` (only on explicit instruction, like any push):

```
git push origin master                     # publish code; no deploy
git push origin origin/master:deploy       # deploy origin/master
git push origin <sha>:deploy               # deploy a specific commit
git push --force-with-lease origin <old-sha>:deploy   # rollback
```

`origin/deploy` always names the deployed commit; `git log origin/deploy..origin/master` shows what's pushed but not yet deployed.

## Docs

`docs/design-implementation.md` is the architecture reference (kept current; cite sections when relevant). `docs/research-strategy.md` feeds the bot prompts. `docs/ROADMAP.md` tracks deferred work. The design borrows patterns from the sibling repo `C:\Users\liual\Claude Projects\datingsim` (OpenRouter client, snapshot versioning).
