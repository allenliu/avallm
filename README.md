# Avalon — AI Edition

A web-based implementation of **The Resistance: Avalon** where the other players — allies and opponents alike — are bots powered by LLMs.

## The hook

Every bot at the table is openly labeled with the model that drives it. You're not bluffing "Player 3" — you're trying to slip a fail card past **Gemini**, or convince **DeepSeek** that you're not Merlin. Knowing *whose* reasoning style you're up against is part of the game.

## Status

Milestone 2: playable in the browser against real LLM bots. Server is zero-dependency Node ≥ 24 (native TypeScript); the client is React + Vite.

```
# one-time client build
npm --prefix client install && npm --prefix client run build

# put an OpenRouter key in .env (gitignored):
#   OPENROUTER_API_KEY=sk-or-...
#   OPENROUTER_MAX_SPEND_USD=2        # hard spend ceiling, recommended

node server/server.ts                      # then open http://localhost:8787
```

The launcher offers LLM opponents (a few cents per game, ~$0.12 measured at 5 players) or free rule-based bots, seated from a browsable agent library (including agents you define yourself). Post-game, the reveal screen shows every bot's secret quest cards and private reasoning.

**Multiplayer**: set "Humans" above 1 to create a lobby and get an invite link — the game auto-starts when the last human seat fills, bots take the remaining chairs, and latecomers can spectate (public information only). No turn timers; play it like mail chess. Works over LAN by sharing your machine's address.

Headless tools:

```
npm test                                   # 44 tests, no API needed
npm run sim -- --players 7 --seed 42       # one heuristic game, full transcript
npm run sim -- --games 200 --talk 0,0      # aggregate win-rate stats
npm run sim -- --agents llm --players 5    # full LLM game headless + cost breakdown
npm run play                               # terminal play vs heuristic bots
```

Layout (design doc §1): `server/engine/` is pure deterministic game logic (event-sourced, seeded RNG, `viewFor` as the hidden-information chokepoint); `server/agents/` is the pluggable agent boundary — LLM, heuristic, random, and a stdio protocol for external agents (the future AvalonBench bridge); `server/llm/` is the OpenRouter chokepoint (spend accounting + ceiling, per-family reasoning suppression, model roster); `server/sim/` is the headless driver and CLIs; `server/server.ts` + `client/` are the web game.

Design docs in `docs/`:

- `docs/research-rules-and-visuals.md` — Avalon rules reference and visual design research
- `docs/research-strategy.md` — gameplay strategy compendium (feeds bot prompts)
- `docs/design-implementation.md` — architecture and implementation design

## Prior art

LLM integration patterns (OpenRouter client, prompt structure) draw on the sibling `datingsim` project.
