# Avalon — AI Edition

A web-based implementation of **The Resistance: Avalon** where the other players — allies and opponents alike — are bots powered by LLMs.

## The hook

Every bot at the table is openly labeled with the model that drives it. You're not bluffing "Player 3" — you're trying to slip a fail card past **Gemini**, or convince **DeepSeek** that you're not Merlin. Knowing *whose* reasoning style you're up against is part of the game.

## Status

Research / design phase. See `docs/`:

- `docs/research-rules-and-visuals.md` — Avalon rules reference and visual design research
- `docs/research-strategy.md` — gameplay strategy compendium (feeds bot prompts)
- `docs/design-implementation.md` — architecture and implementation design

## Prior art

LLM integration patterns (OpenRouter client, prompt structure) draw on the sibling `datingsim` project.
