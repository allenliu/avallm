# AvaLLM roadmap

**Status:** written 2026-07-22, the day the first Railway deployment went live.
Companions: [design-implementation.md](design-implementation.md) (architecture),
[design-multiplayer.md](design-multiplayer.md) (MP phases). This collects everything deferred
during M1→MP1 plus what deployment newly unblocks, in rough priority order.

## Now — deployment made these urgent

1. **Session snapshots & restore.** Games live in memory; every Railway redeploy or restart kills
   every running game — fatal for the no-timer "mail chess" pacing where games span days. `Game`
   is already plain JSON: snapshot lobbies + sessions (minus agent instances, reconstructable from
   defs) to disk on every event append, restore on boot. Needs a Railway volume. Also persist the
   OpenRouter spend counter — the `OPENROUTER_MAX_SPEND_USD` ceiling currently resets per process,
   so today the only durable budget cap is the key-level limit on OpenRouter.
2. **AFK → Autopilot seat handoff.** Correspondence play *will* strand games on a vanished human.
   Host action: permanently convert a human seat to the heuristic agent (per-seat version of the
   existing per-decision degrade), marked in the feed and the reveal.
3. **Cost / usage dashboard.** `/api/usage` already reports per-agent, per-kind real-USD spend;
   there is no UI. A small admin view (gated by invite code) showing spend by model, fallback
   rates, and reasoning-leak counters — the observability that keeps a shared deployment honest.
4. **Custom agents on deployments** (explicitly deferred): attach a volume at `/app/data`; add
   gated `DELETE /api/agents/:id`; surface (rather than silently skip) custom agents whose roster
   model id disappeared. Optional third tier: checked-in `agents/*.json` — curated agents that
   version with the repo and appear on every deployment.

## Next — gameplay quality (the M3 core)

5. **Model coherence harness.** Scripted golden-set game states with a known best action; score
   every roster model; drop or demote models that fallback >10% or play incoherently. This is the
   honest answer to "how much scaffolding before it stops being the model playing" and gates
   roster additions. (datingsim `tools/rearch-spike` pattern.)
6. **Balance measurement with LLM tables.** Heuristic self-play is evil-favored (~66/34 at 7p,
   ~80/20 at 5p/10p) because heuristic good has no discussion channel. Measure LLM-table win
   rates now that bots talk, signal leans, and answer questions; only then tune.
7. **Semantic leak measurement.** Structural leaks are impossible by design; bots can still *say*
   too much ("us evil folks"). Measure incidence from reveal logs before deciding whether a cheap
   post-hoc leak-judge call on evil/Merlin utterances is worth the cost/latency.
8. **Prompt iteration from real games.** The reveal logs (private thinking + actions) are a
   goldmine: recurring confusions (early-game state muddles, lean-vs-vote contradictions) become
   prompt or nudge fixes, like the direct-address and leader-defends-own-team nudges already did.
9. **Kimi cosmetic reasoning leak** (1 token/call): silence or tolerate explicitly; currently
   noisy in logs only.

## Social & presentation

10. **Free-form human chat** (MP3 headline): humans interject any time during discussion via a
    non-turn `chat` event that feeds bot transcripts; bots stay turn-based (which also caps token
    spend). Turn-based-only talk is the biggest gap between AvaLLM multiplayer and a real table.
11. **Reveal dramatization.** Vote-chip flips, one-at-a-time quest card reveals (fail cards last),
    assassination staging, and a polished "what they were really thinking" timeline — the design
    doc's retention feature, still in its functional-only form.
12. **Career stats.** Per-agent (and per-human) records across games: win rate by alignment,
    assassination accuracy, fallback rate. Makes the agent library feel alive and gives custom
    agents something to compete on. Needs the same volume as #1.
13. **Lobby & spectate polish:** lobby chat, spectator count in game UI, host controls (kick,
    cancel lobby), 10-player tables in the web UI (engine supports 10; web caps at 9).

## Agents & ecosystem

14. **AvalonBench bridge** (designed, unbuilt): Python stdio shim wrapping their naive baseline
    agents as difficulty-calibration seats; the ICLR "Strategist" (MCTS) as a boss seat. Local
    only — stdio agents never run on shared deployments.
15. **Per-user agent libraries** — requires identity, so parked until accounts matter for other
    reasons. Global-shared library is the right call at friends-scale.
16. **Roster refresh discipline.** OpenRouter slugs go stale; the roster is one file, additions
    should ride the coherence harness (#5). Revisit each time datingsim's MODELS.md updates.

## Rules content (engine-ready, unscheduled)

17. **Lady of the Lake** (loyalty inspection, quests 2–4) — biggest good-side buff, rulebook-
    recommended at 7+; **Targeting** (leader picks quest order); **Excalibur** (force-switch a
    played card). Research doc §4 has the exact rules. Each is an engine phase addition + UI.

## Deliberately not doing

- **Turn timers** — rejected by design; correspondence pacing is the identity.
- **Anti-cheat beyond hidden views** — friends-scale; screen-sharing is out of scope.
- **Prompt-injection "fixes" beyond format guards** — social-engineering the bots is the game.

## Known issues ledger

| Issue | Severity | Status |
|---|---|---|
| Redeploy kills running games | high (deployed) | → #1 |
| Spend ceiling resets per process | medium | → #1; key-level limit is the real cap today |
| Heuristic self-play evil-favored | low (baseline only) | → #6 measures the real (LLM) number |
| Kimi 1-token reasoning leak | cosmetic | → #9 |
| Early-game bot state confusion | low, shrinking | → #8 |
| Custom agents ephemeral on Railway | accepted for now | → #4 |
| Browser cache serves stale bundle after deploy | annoyance | hard-refresh; consider cache headers with #1's release work |
