# Bot evaluation & self-improvement framework — design

**Status:** design brainstorm, 2026-07-23, not yet built. Companions:
[design-implementation.md](design-implementation.md) (architecture),
[ROADMAP.md](ROADMAP.md) (this doc absorbs roadmap #5, #7, #8 and provides the measurement
substrate for #6). Motivating incidents: a Merlin (Kimi seat) declaring "no trust Allen" every
turn with zero public evidence — trivially assassinated; a DeepSeek that vocally endorsed a team
twice, watched it fail, then silently passed — behavior no human ever shows.

The goal: improve bot play over time **without human intervention** — prompt/config versions are
generated, evaluated, and promoted by an automated loop, with an LLM judge (Claude) that has full
transparency into roles and private thinking.

---

## 1. Principles

### 1.1 The unit under test is an `AgentDef`

An agent is already a config: model + prompt layers (`server/agents/defs.ts`). Once §2's layering
lands, an `AgentDef` is the **complete behavioral genome** — everything that distinguishes one bot
version from another lives in it. Version them, archive them, evolve them. The engine, facts
rendering, and output contracts are constant infrastructure underneath and are NOT part of the
genome.

### 1.2 Code computes facts, prompts decide policy

The recurring design question — "deterministic nudging vs. richer prompts?" — resolves with one
rule: **deterministic code owns facts; prompts own policy; the two must not blur.**

A *fact* is mechanically derivable from the public record and indisputable by any observer at the
table: "Haiku mentioned you since your last turn", "you endorsed [X,Y] at Q2.1 and voted approve;
Q2 failed", "the next proposal is the hammer". A *policy* is a judgment about what to do:
"respond when accused", "vote wrong sometimes as Merlin". Litmus test: **could a player at the
table dispute it?** Disputable → policy.

The facts layer is not "hardcoding intelligence" — it compensates for what LLMs are bad at
(attention over long transcripts, counting, cross-referencing votes with speeches), the way
handing a chess player an accurate board isn't whispering moves. It can grow forever without
prescribing behavior, because facts don't prescribe.

This implies three prompt layers (today there are two):

1. **Integrity layer** — engine-owned, non-overridable: rules digest, output contracts,
   injection guard, view rendering. About not breaking parsing and not leaking hidden info.
   Already right; near its permanent size.
2. **Facts dossier** — engine-owned, non-overridable, strictly neutral. Everything in
   `publicStateText` plus derived social facts: who addressed you (`directAddresses`), your own
   public commitments and contradictions of them (§4), hammer proximity, per-player vote/speech
   summaries. Presented as data, zero imperatives. Every agent gets it equally — custom agents
   compete on strategy, not bookkeeping.
3. **Policy layer** — fully overridable; all defaults live here. `TABLE_TALK_NORMS`,
   `ROLE_GUIDANCE`, "respond when addressed", pass norms. The built-in text is the *reference
   bot's opinion*, not platform law. A custom agent that wants a taciturn, cryptic persona may
   replace it wholesale.

Known blurred spots to fix: the directive half of the `directAddresses` note ("respond to it
now") is policy inside engine text; `TABLE_TALK_NORMS` is pure policy but not overridable; the
discuss ask mixes turn mechanics (fact) with pass-encouragement ("most players pass by round 2" —
policy, and it actively taught the DeepSeek silence).

### 1.3 Opinions are enforced by selection, not mandates

The pressure to hardcode ("bots keep doing X wrong, add a rule") is redirected into the eval:
metrics measure the behavior, and prompt versions that do better win promotions. Mandates freeze
one theory of good play into the platform; metrics let theories compete. Escalation ladder for
any observed bad behavior:

1. **Is a fact missing or buried?** → add to the dossier.
2. **Is default policy weak?** → tune the built-in prompt, validated by paired eval.
3. **Does the game mechanically break** (stalls, leaks, unparseable)? → integrity layer.
   Almost nothing should reach here.

Product floor: a table of custom agents that all pass forever is broken even though no rule was
violated. If that becomes real, solve it mechanically in the engine (the way empty discussion
rounds already end early), never with mandatory prompt text.

---

## 2. Getting signal cheaply: role-forcing + paired seeds

Naive A/B ("200 games with prompt A, 200 with B, compare win rate") is nearly useless: Avalon
outcomes are high-variance and a 10-point win-rate delta needs ~400 unpaired games to detect.
Two fixes:

- **Force the role.** Testing a Merlin prompt? Every eval game seats the candidate *as Merlin*.
  Today `sim.ts` deals roles from the seed, so the role under test lands on the candidate ~1/7 of
  the time — a 7× waste. Needs a `--forceRole` (or seed-filtering) sim option.
- **Pair the seeds.** Run seed S once with baseline-in-role and once with candidate-in-role;
  identical opponents, identical everything else. Matched pairs compare how the *same game*
  unfolds with one prompt swapped, killing most variance. The engine's purity (seeded PRNG, no
  I/O) makes this exactly reproducible.
- **Fix the table.** Opponent roster (models AND prompt versions) is held constant within an
  eval generation; only the candidate seat varies.

## 3. Metrics: measure behavior, not (just) wins

Win rate is a guard, not a target. Primary signal comes from the event log, most of it with no
LLM cost:

**Programmatic (pure functions over the game artifact):**
- **Conspicuousness** — per player, correlation of public stance (votes against evil-containing
  teams, accusations by name, leans) with ground-truth evil. Merlin should not be the top-ranked
  good player. Catches "no trust Allen" instantly.
- **Reactivity / silence-after-contradiction** (§4) — passed while holding a freshly-contradicted
  public commitment.
- **Assassination outcomes** — real hit rate against this Merlin; unfakeable.
- **Guards** — good win rate, degraded-decision count, cost/game, utterances/game.

**Cheap-LLM probes:**
- **Virtual assassin** — end of every game (and at mid-game checkpoints), a cheap model gets the
  *public-only* transcript with the assassin prompt, N samples: who is Merlin? P(picked) is a
  per-game detectability number and a "when did Merlin become obvious?" curve. Works whether or
  not real assassination happened.

**The Merlin frontier.** Concealment alone Goodharts into a Merlin who says nothing. The
counter-axis is **influence**: did good teams trend cleaner when Merlin spoke/proposed (paired
against baseline)? Merlin eval always reports the pair (influence, concealment) — a promotion
that improves one by tanking the other is a regression.

## 4. The commitment ledger

One pure function over the public log, three consumers. Tracks per player: stated positions
(endorsements, accusations, votes with stated reasons), and derives "events since your last
utterance that contradict a position you hold."

1. **Facts dossier** — "Q2 just FAILED; you publicly endorsed that team" (stated as fact; what to
   do about it is the agent's business).
2. **Reactivity metric** — flag pass-while-contradicted decisions (the DeepSeek incident,
   detected in code).
3. **Judge input** — incident reports that cite a player's own commitments are much sharper.

Same shape as `directAddresses`: deterministic social state the LLM is bad at tracking itself.

## 5. The judge: two passes, full transparency

The event log already carries seat-private `thinking` and `scratchpad` events, so the judge input
is just the unredacted log + roles. Two passes per game:

1. **Blinded pass** — public info only; predict each player's role with confidence. Doubles as a
   second detectability metric and calibrates the judge itself.
2. **Revealed pass** — with roles and thinking: per-seat scorecards (concealment / deduction /
   influence / table-talk quality) and, more valuable, **incidents**: specific moments cited by
   event seq where a player leaked, blundered, dodged, or excelled. ("Seat 4 declared distrust of
   a hidden-evil player at seq 47 with zero public evidence; only Merlin's knowledge supports
   this.")

Scores draw trend lines; incidents feed the situation bank and the optimizer. Judge hygiene: the
judge never sees which config produced the game, and promotion anchors on the unfakeable metrics
(virtual-assassin rate, real assassination rate, conspicuousness) with judge scores advisory —
otherwise the optimizer eventually learns to game the judge.

## 6. The situation bank (mined regression tests)

Because prompts consume only `PlayerView` (the hidden-information chokepoint), any decision point
serializes as `(kind, view, scratchpad)` and **replays against any prompt version as a single LLM
call**. Judge-flagged incidents snapshot into a growing bank of single-decision regression tests:

- The Merlin-leak moment → assert (cheap checker call or pattern rule) the candidate's reply
  doesn't name an evil player without public evidence.
- The DeepSeek-silence moment → assert the reply acknowledges the failed quest it endorsed.

Costs cents and seconds vs. dollars and hours for full games. This is the base of the testing
pyramid: **situation bank** (every prompt edit) → **small paired batch** (~20 seed pairs,
programmatic metrics) → **full batch + judge** (promotion candidates only).

## 7. Failure taxonomy (living list)

Incident families observed or expected; each gets a detector (code where possible, judge
otherwise) and contributes situations to the bank:

1. **Knowledge leak** — public stance explainable only by private knowledge (Merlin's "no trust
   Allen"; also "us evil folks"-style slips, roadmap #7).
2. **Commitment failure** — unreactive, contradictory, or evasive relative to one's own public
   record (DeepSeek's silent pass after its endorsed team failed).
3. **Hammer blindness** (expected) — not adjusting to proposal 5 mechanics: wasted rejections,
   or failing to fight proposals 3–4 knowing the hammer looms.
4. **Fail coordination** (expected) — double-fails exposing two evil at once; or both evil
   playing success out of mutual deference.
5. **Vote-speech incoherence** (expected) — lean says approve, vote says reject with no
   explanation; the existing lean-vs-vote confusion from roadmap #8.

## 8. The closed loop

```
champion AgentDef vN
  → paired eval games (role-forced, fixed table) → game artifacts
  → programmatic metrics + judge scorecards + incidents
  → optimizer (Claude) reads: current prompts + incidents + metric deltas
  → proposes vN+1 candidates (2–3 variants)
  → gate 1: situation bank (all regressions pass)
  → gate 2: paired batch vs champion — paired-bootstrap significance on the
            target metric; hard floors on guards (influence, win rate, cost,
            degraded count, utterance volume)
  → promote or discard; archive the run either way
```

Archive every champion; occasionally re-seat old champions as opponents (a small league) so
improvement isn't overfit to one opponent pool, and the Elo-ish trend line over generations is
the long-term health metric. The optimizer itself can literally be a scheduled Claude session
reading the latest report — it's the easy part, and it's built LAST, because a self-improvement
loop is only as good as the reward signal under it.

## 9. Build order

1. **Game artifacts** — persist full event log + agent configs + seed as JSONL per sim game
   (plumbing; the data already exists in `game.log`).
2. **`--forceRole` + paired-seed mode** in `server/sim/sim.ts`.
3. **Commitment ledger + programmatic metrics** over artifacts (conspicuousness, reactivity,
   assassination outcomes, guards) — pure, unit-testable, zero LLM cost.
4. **Virtual assassin** probe.
5. **Judge CLI** (two-pass scorecards + incidents) → **situation bank** snapshot/replay.
6. **Optimizer loop** (generation, gating, promotion, archive).

The prompt-layer restructure (§1.2 — facts/policy split, norms made overridable) is independent
and safe to do early: it moves text between layers without changing built-in behavior, and it's
what makes an `AgentDef` diff capture the whole behavioral change.
