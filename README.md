# Avalon — AI Edition

A web-based implementation of **The Resistance: Avalon** where the other players — allies and opponents alike — are bots powered by LLMs.

## The hook

Every bot at the table is openly labeled with the model that drives it. You're not bluffing "Player 3" — you're trying to slip a fail card past **Gemini**, or convince **DeepSeek** that you're not Merlin. Knowing *whose* reasoning style you're up against is part of the game.

## Status

Milestone 1: pure game engine + pluggable agents, no LLM yet. Requires Node ≥ 24 (runs TypeScript natively; zero dependencies).

```
npm test                                   # rules, knowledge-matrix, leak, flow, fuzz, stdio tests
npm run sim -- --players 7 --seed 42       # one game, full transcript
npm run sim -- --games 200 --talk 0,0      # aggregate win-rate stats
npm run play                               # play a game in the terminal vs heuristic bots
```

Layout (design doc §1): `server/engine/` is pure deterministic game logic (event-sourced, seeded RNG, `viewFor` as the hidden-information chokepoint); `server/agents/` is the pluggable agent boundary — heuristic and random built-ins plus a stdio protocol for external agents (the future AvalonBench bridge); `server/sim/` is the headless driver and CLIs.

Design docs in `docs/`:

- `docs/research-rules-and-visuals.md` — Avalon rules reference and visual design research
- `docs/research-strategy.md` — gameplay strategy compendium (feeds bot prompts)
- `docs/design-implementation.md` — architecture and implementation design

## Prior art

LLM integration patterns (OpenRouter client, prompt structure) draw on the sibling `datingsim` project.
