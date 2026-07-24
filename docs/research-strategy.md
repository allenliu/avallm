# The Resistance: Avalon — Strategy Research Compendium

Research compiled for the AI-powered Avalon project: an evidence-based reference on how strong
humans play the game, what published AI/LLM work has found, and a distilled playbook of
heuristics that can be embedded directly in bot system prompts.

Sources include the avalon-game.com role wikis, BoardGameGeek strategy discussion,
boardgame.business's strategic analysis, Yuzuko Nakamura's CMU dataset paper ("Is it Percival
time yet?", SIGBOVIK 2017, 61 recorded games), Mark's AI-tournament analysis (markmywords
substack), Ben Murphy's "Mechanically Solving Avalon", and the academic LLM-agent literature
(AvalonBench, ReCon, the LLM Agent Society paper, DeepRole, and the Assassin-classifier paper).
Full source list at the end.

---

## 1. Basic strategy: votes, teams, and inference

### 1.1 Why evil wants to be on quests (and good must gatekeep)

- The whole game reduces to one question: **can good assemble teams containing zero evil
  players three times?** Evil wins by getting even one minion onto three quests (or by
  assassinating Merlin at the end).
- Evil players therefore *want* to be on teams and want teams that contain at least one evil
  player. The AvalonBench "Naive Minion" baseline captures the essence: approve any team
  containing at least one evil player, propose teams with evil players on them. Real evil play
  is this heuristic plus camouflage.
- Good players know only their own alignment (unless Merlin/Percival). Their core tool is
  **Bayesian elimination**: every quest result, vote, and proposal shrinks the space of
  possible evil teams. The AvalonBench "Naive Servant" baseline formalizes good's core logic:
  maintain a probability distribution over evil-team combinations and only approve teams that
  are consistent with the evidence (i.e., statistically likely to contain no evil).

### 1.2 The meaning of approve/reject

- **A vote is information.** Every player's vote on every proposal is public and permanent.
  Strong players track the full vote matrix, because:
  - Evil players systematically approve teams that contain evil and reject clean teams.
  - Merlin, knowing everything, tends to vote "correctly" — approving clean teams, rejecting
    dirty ones. This is simultaneously Merlin's greatest power and greatest tell (see §2 and §3).
- **Good players should generally reject teams they are not on.** Reasoning: a good player
  knows with certainty that *they themselves* are good. A team including themselves has one
  guaranteed-good slot; any team excluding them is strictly less trustworthy from their
  epistemic position. This is the standard baseline for generic good.
  - **When NOT to follow this rule:**
    - When the proposed team consists of players who have already been strongly validated
      (e.g., they were on a clean quest that would have been failed if any were evil).
    - On the **5th proposal ("hammer")**: five consecutive rejections lose the game for good
      outright, so good must approve the fifth proposal almost no matter what. Rejecting on
      hammer is itself a strong evil tell (and a classic AI blunder — DeepRole was observed
      rejecting the fifth proposal, a game-losing move).
    - When you're deliberately using an approve as a trust/communication signal (advanced play,
      §3), or when rejecting would burn a proposal count good needs later.
  - Conversely, **an evil player faces a bind**: rejecting clean teams too consistently
    outs them; approving teams they're not on looks "too generous". Good players should notice
    players who are unusually happy with teams that exclude them.
- **Proposal counting matters.** Each round allows up to 5 proposals; leadership passes
  clockwise. Good can afford some rejections to gather information, but the count is a
  resource. Evil benefits from burning proposals (drives toward forced approval) and from
  chaos in general.

### 1.3 First-quest dynamics

- The first quest (2 players in 5–7p games, 3 in 8+) carries the least information and the
  most ritual. Common patterns:
  - Many groups **reject the first proposal on principle** to harvest a free round of voting
    data ("always reject mission 1" is a widely-cited convention). Who approves an arbitrary
    first team, and who proposed whom, seeds the trust graph.
  - The **leader proposing themselves plus one other** is standard; proposing a team *without
    yourself* on quest 1 is unusual and reads as either weird-good or evil-splitting.
- **Should evil fail quest 1?** Empirics from the CMU dataset (61 recorded games):
  - On **2-person first missions**, evil essentially never fails (1 of 16 opportunities taken).
    Failing a 2-person team instantly creates one good player who *knows* a specific evil
    player, a terrible trade.
  - On **3-person first missions**, evil failed 67% of the time (16 of 24 opportunities), and
    first-mission fails correlated with evil wins (13-3 with a fail vs. 5-4 without). The
    "slow-play everything" strategy is overrated: an early fail banks a point while suspicion
    is maximally diffuse.
  - When **two evil players** were both on a 1-fail mission, observed play on mission 1 was
    skewed toward *zero* fails (each evil throwing fail with only ~20–25% probability),
    versus roughly coin-flip fail rates on missions 2–3 — evil correctly fears the
    double-fail reveal early.

### 1.4 Fail-count inference

- The number of fail cards on a failed quest is hard evidence. **N fails ⇒ at least N evil on
  that team.** A 2-fail result on a 3-person team means 2 of those 3 are evil — devastating
  information leakage for evil ("evil coordination failure").
- A quest that **succeeds** does *not* prove the team clean: an evil player may have slow-played
  (thrown success). Good players chronically under-weight this. The CMU paper found evil's win
  rate was *higher* (.76 vs .60) in games featuring multi-evil teams, hypothesizing that good
  players reason badly about teams containing more than one evil — they tend to assume "one fail
  = one evil, other members clean."
- Track **who was on every failed quest**; the intersection/union structure of failed teams is
  the main deductive engine. Ben Murphy's "mechanically solving Avalon" work shows that in a
  5-player game the pure logic of overlapping failed teams (only 2 evil exist, so only 2
  missions can ever fail from a "clean list") is nearly strong enough to solve the game if
  players coordinate — which is precisely why the Assassin exists as a check, and why real
  play is about the social layer on top of the logic.
- **Fifth quest requires no restraint**: on the last quest evil should always fail (any number
  of fails is fine — coordination risk is irrelevant). Similarly quest 4 in 7+ player games
  requires **two** fails, so a lone evil player on that quest cannot fail it usefully and
  should usually throw success (a single fail there reveals an evil presence for zero points).

---

## 2. Role-specific strategy

### 2.1 Merlin — guide without being seen

Merlin knows all evil (except Mordred). Merlin's job is to steer good to three clean quests
while surviving the assassination.

- **Herd, don't accuse.** Push discussion toward good players and away from evil ones with
  soft, multi-interpretable comments ("I just have a feeling about this team", "I'd rather see
  X than Y on this one"). Back up correct reads made by *other* good players rather than
  originating every read yourself.
- **Vote imperfectly on purpose.** Merlin who votes correctly on every proposal is trivially
  identified — the Assassin's #1 technique is scanning the vote matrix for the good player
  with the highest voting accuracy. Deliberately approve one early dirty team (ideally one
  that's going to be approved anyway, or one where a fail costs little), or reject a clean
  team once, to inject noise. The AI-tournament result quantifies the stakes: a
  perfectly-voting "AggressiveMerlin" bot lifted good's win rate to 43%, but a simple
  "MerlinDetector" assassin crushed it to 4%; a "SneakyMerlin" hiding in noise recovered to ~21%.
- **Early game: talk less.** The best concealment is withheld comment in rounds 1–2; let the
  quests generate public evidence you can then "agree with".
- **Use the Servant script.** Merlin should sound exactly like a sharp Loyal Servant:
  occasionally wrong, visibly reasoning from public information, sometimes suspicious of an
  actual good player. Never react with certainty to a reveal that surprised everyone else
  ("never seem unsurprised by mission outcomes" is a listed Assassin tell).
- **Endgame calculus:** if good is about to win the third quest but Merlin is exposed, it can
  be correct for Merlin to deliberately muddy things or even for good to route the win through
  a team Merlin isn't on. Winning three quests is only half the win condition; surviving the
  assassination is the other half.
- **Mordred games:** Merlin does *not* see Mordred. Merlin must show calibrated uncertainty —
  acting certain about the full evil roster when one member is hidden is both wrong and a tell.

### 2.2 Percival — find Merlin, then become Merlin

Percival sees two candidates (Merlin and Morgana) and must work out which is which.

- **Distinguish by quality of guidance.** Watch which candidate's suggestions, votes, and
  proposed teams actually track the truth as quests resolve. Morgana will eventually push a
  dirty team or defend an evil player; Merlin's steering will be quietly correct. Fail results
  are the acid test: which candidate approved/proposed the failed teams?
- **Never defend Merlin directly.** Publicly protecting one specific player paints the target.
  Support Merlin's *positions* (vote with them, echo their reads) without naming them.
- **Be the decoy.** Percival's second job is to *look like Merlin*: act confident,
  claim reads, be a little too knowing. Every unit of Assassin suspicion Percival absorbs is
  Merlin-protection. Taking the assassination shot instead of Merlin is a win.
- **The counterfeit-confidence trap:** an Assassin watching for "the player narrowing things
  down between exactly one evil and one good player" can identify *Percival* — and then infer
  Merlin from Percival's behavior. Percival must not visibly run their private
  two-candidate experiment.
- **Percival claims:** publicly claiming Percival can consolidate good trust late (typically
  after multiple fails, to help construct one clean team), but the CMU data shows games with
  Percival claims had a *higher* Merlin-assassination rate (.59 vs .50, n.s.) — a claim
  focuses evil's attention on whoever Percival has been implicitly cooperating with. Claim
  late or not at all, and only when the quest math demands it.

### 2.3 Assassin — read the game backward

Even when good passes three quests, evil wins ~half the time via assassination in human play
(over 50% of evil wins in some datasets come from the shot). The assassination conversion rate
is the single biggest lever on game balance.

- **Vote-matrix analysis first, vibes second.** Merlin votes correctly "pretty much always";
  compute each good player's voting accuracy against the now-known truth and shoot the most
  accurate one who isn't better explained as Percival. A published ML result: a simple linear
  SVM over game-log features (chiefly voting behavior) achieved above-average-human
  assassination accuracy — the signal is real and mostly in the votes.
- **Behavioral tells:** early precise suspicion of an actual evil player with no public
  evidence; conspicuous silence from an otherwise-sharp player; never proposing an evil player
  across the whole game; visible relief/tension at reveals; hedged phrasing that implies
  knowledge ("I just don't trust him").
- **Distinguish Merlin from Percival:** Percival mimics Merlin but his information is one
  step removed — Percival's early votes are noisier (he doesn't know which candidate to trust
  yet, so his accuracy *improves* mid-game as he solves Merlin/Morgana; Merlin's accuracy is
  flat-high from round 1). A player who was confidently wrong early then snapped to correct is
  Percival; a player who was quietly right from the start is Merlin.
- **Use the full team.** The assassination is a group decision in practice — evil should pool
  observations before the shot (rules encourage discussion). Morgana has the best data:
  whoever Percival was mirroring is Merlin.

### 2.4 Morgana — the counterfeit Merlin

- **Primary job: capture Percival.** Act like a Merlin who is trying to be subtle: make
  soft reads, steer teams gently, be helpfully wrong in ways that look like deliberate
  Merlin-noise. If Percival trusts Morgana, Percival amplifies evil's agenda with good-team
  credibility — a double agent good built themselves.
- **Sit on clean-ish reads early.** Morgana knows the evil team, so she can make "impressively
  correct" reads about her own teammates (calling one evil teammate suspicious) to buy
  Merlin-like credibility — the mirror image of bussing (§2.6).
- **Watch for who's watching.** The player quietly tracking your consistency against another
  specific player is Percival; note whom else he watches — that's Merlin, and that's your
  report to the Assassin.

### 2.5 Mordred and Oberon

- **Mordred (hidden from Merlin):** Mordred can act *fully trustworthy from Merlin's own
  point of view* — Merlin will happily put Mordred on teams. Mordred should play an
  aggressively "good" long game, hunting for a seat on the decisive third quest, and is evil's
  best candidate for deep cover (§3.4). Mordred's presence also degrades Merlin's confidence
  globally: every Merlin read now carries a "unless it's Mordred" asterisk, and an
  over-certain Merlin becomes easier to shoot.
- **Oberon (unknown to and unaware of other evil):** Oberon must *infer* his teammates from
  play, just like a good player but with inverted goals. Standard Oberon play: fail
  aggressively when on quests (nobody can coordinate with you anyway; a second fail card
  appearing tells the *other* evils where you are, which is useful to them), vote for chaotic
  teams, and accept being read as "the loud wrong good player." Other evils should watch fail
  counts to locate Oberon and then quietly protect him. Oberon is a good-team handicap:
  adding him tilts balance toward good (recommended in the CMU paper for hard game sizes).

### 2.6 Generic evil coordination

- **When to fail (consensus heuristics):**
  - Quest 1: usually **pass** on 2-person teams (near-universal); **often fail** on 3-person
    teams (67% observed, correlated with evil wins).
  - Quests 2–3: **fail by default** when you're the only evil on the team. Slow-playing two
    quests in a row means evil must win *all three* remaining quests — the trust you bought
    rarely pays that debt. The boardgame.business analysis explicitly calls the popular
    slow-play strategy a trap: it "generates insufficient trust" for what it costs.
  - Two evil on a 1-fail team: **pre-agree a convention** (e.g., "leader fails" / "earlier
    seat fails" / "the one who proposed passes"). Real groups botch this constantly — 92% of
    observed coordination situations were exactly this case, and double-fails hand good a
    2-of-3-are-evil proof. Perversely, the CMU data suggests multi-evil teams still favored
    evil overall (good reasons poorly about them), so don't panic-avoid them; just have the
    convention.
  - Quest 4 in 7+ games (needs 2 fails): lone evil should **pass**; two evils should both fail.
  - Quest 5 / evil's third point: **always fail.**
- **Bussing (sacrificing a teammate):** voting against, accusing, or even failing-out a fellow
  evil to build your own good-credit. Powerful mid-game when one teammate is already burned
  (on two failed quests, publicly suspected): pile on, "confirm" the good team's read, and
  ride the credibility onto the final quest. The buss also launders the Assassin: an evil
  player who spent the game attacking a (burned) evil looks like a validated good player, and
  their endgame shot benefits from everything they observed while trusted.
- **Vote discipline:** evil's biggest systematic leak is the vote matrix. Mix in rejections of
  dirty teams and approvals of clean teams you can afford; never be the *only* rejector of an
  obviously clean team; never reject on hammer.
- **Seating/timing:** clustered evil seats struggle to get proposals through but control
  consecutive leaderships; spread seats give more proposal opportunities. Use leadership order
  to plan which round each evil player will "own."

---

## 3. Advanced / competitive concepts

### 3.1 Meta-signaling and vote-pattern analysis

- Competitive play treats the **vote matrix as the primary text** and table talk as
  commentary. Per-player features that strong humans (and the SVM assassin) use:
  - Voting accuracy vs. ground truth (Merlin-finder).
  - Approve-rate on teams excluding the voter (evil-finder — evil is happy off-team).
  - Rejection of eventually-proven-clean teams (evil-finder).
  - Proposal composition history: who never proposes players later shown evil (Merlin-ish),
    who consistently includes one particular other player (pair-signal).
  - Behavior on hammer (5th proposal): any rejection is near-proof of evil.
- **Deliberate signal votes**: good players sometimes use an otherwise-irrelevant vote to
  signal trust ("I approved your team even off it — I'm with you"). Percival↔Merlin implicit
  coordination through matched voting is the canonical example; it's also exactly what the
  Assassin scans for, so mirrored votes must be imperfect.

### 3.2 Merlin protection: everyone plays Merlin

- The strongest good-team meta: **all good players act slightly Merlin-like** — confident
  reads, decisive votes, willingness to accuse. The substack analysis states it directly:
  Merlin operates best when the whole good team is "voting accurately, calling out spies,
  defending innocents" — i.e., generating cover traffic. If three players look knowledgeable,
  the Assassin's shot is a coin flip among them.
- Corollary for generic Servants: **claim confidence you don't have.** A timid, visibly
  clueless Servant shrinks the Assassin's candidate pool. Loud wrong reads are a
  *contribution* (they make real Merlin noise plausible).
- Good should also plan the **endgame board state**: prefer winning the third quest with a
  team/history that leaves ≥2 plausible Merlin candidates. Occasionally that means the actual
  Merlin takes a public wrong position right before the win.

### 3.3 The information-exploitation arms race

The AI-tournament analysis frames competitive Avalon as a layered arms race with no dominant
strategy:

1. **Base:** never make provably losing moves (reject on hammer, propose known-evil, etc.).
2. **Intermediate:** track voting/mission data objectively (trust scores beat social intuition
   — the tournament-winning ArmanBot used pure trust-scoring, no Merlin info, ~62% good win).
3. **Advanced:** exploit private information but *hide the exploitation inside normal
   variance* (SneakyMerlin).
4. **Meta:** detect and punish others' information exploitation (MerlinDetector), and detect
   the detectors.

Aggressive evil play (pushing evil-containing teams hard) wins until opponents start
pattern-matching it; the equilibrium is mixed strategies everywhere.

### 3.4 Evil deep cover

- One evil player (ideally Mordred) plays a **perfect good game**: votes like a model Servant,
  fails nothing early, builds maximal trust, aims to be on the good team's "certain" final
  quest. Works best paired with a loud, sacrificial teammate soaking attention (or an Oberon
  doing it involuntarily).
- Deep cover's payoff is double: a late fail on the decisive quest, or — if good wins three
  quests — an assassination informed by a whole game spent inside good's trust circle.
- Cost: if *both* evils deep-cover, evil loses on points. Someone has to bank fails; deep
  cover is a team allocation decision, not an individual one.

### 3.5 Common tells (human meta)

- **Evil tells:** contentment when excluded from teams; over-eager approval of specific
  pairings; accusations that conveniently never land on an actual evil; "vote-then-justify"
  reasoning; going quiet after a fail they were on; rejecting on or near hammer.
- **Merlin tells:** early accurate suspicion without evidence; too-perfect voting; hedging
  language masking certainty; discomfort/deflection when asked for reasoning ("just a gut
  feeling") repeatedly; never proposing any evil player all game; visible physical tells at
  reveals (in tabletop play).
- **Percival tells:** binary fixation on two specific players; early noise then sudden
  accuracy; over-protective reactions when one specific player is accused.

---

## 4. AI-specific findings: LLMs playing Avalon

### 4.1 AvalonBench (Light et al., 2023)

- Benchmark of LLM agents vs. simple rule-based baselines (Naive Servant / Minion / Assassin /
  Merlin as in §1). Headline: **out-of-the-box LLM agents lose to even naive baselines.**
  GPT-3.5 as Servant: 22–38% win rate; evil roles much easier (GPT-3.5 Assassin ~62–67%).
  In all-LLM games, **evil beat good ~8:2** — comparable to rookie human tables. Deduction and
  Merlin-hiding are the hard parts; being evil is "easier" for LLMs mostly because good LLMs
  are bad.
- **Observed failure modes (directly relevant to our bots):**
  1. **Self-incrimination:** evil agents leak their identity in discussion despite explicit
     instructions to conceal it.
  2. **Deduction–action gap:** agents reach ~76% accurate hidden-role deductions but fail to
     *act* on them (approve teams contradicting their own stated reads).
  3. **Reasoning/action inconsistency:** proposing teams that contradict the agent's own
     expressed suspicions.
  4. **Repetitive, low-content speech:** restating prior turns without persuasive force.
- **Engineering notes:** ReAct-style zero-shot CoT agents; recursive summarization of game
  history to fit context; a separate small "parser" LLM to coerce free-text into legal game
  actions. All three patterns are worth copying.

### 4.2 ReCon — Recursive Contemplation (Wang et al., 2023)

- Premise: default LLM agents implicitly **assume observed information is honest** — fatal in
  a deception game. ReCon adds two passes: **formulation contemplation** (draft thought +
  speech) then **refinement contemplation** (revise before speaking), each incorporating
  **first-order perspective taking** ("what does each player believe/want?") and
  **second-order** ("what will they infer about *me* from this action/statement?").
- The second-order step is the key import for our bots: before any public action, the agent
  should ask *"what does this reveal about my role?"* — this is exactly the check whose absence
  causes AvalonBench's self-incrimination failures.
- ReCon measurably improved GPT agents' resistance to deception without fine-tuning, but
  residual weaknesses remained in logical reasoning, consistent speaking style, and format
  adherence.

### 4.3 LLM Agent Society paper (2310.14985)

- Six-module agent architecture: **memory/summarization → analysis (role inference) →
  planning → action selection → response generation → experience learning.** With all modules,
  their agents beat baseline LLM agents ~90–100% of games; ablating the analysis module
  dropped win rate ~30 points; ablating strategy-learning dropped it ~30–40 points. Structured
  role-inference and explicit strategy memory matter more than raw model quality.
- **Emergent behavior:** evil agents spontaneously adopted false identities in discussion
  (Morgana claimed to be someone else 10% of games, Assassin 15%) without being told to —
  LLMs *can* deceive when the scaffold supports it.
- **Persistent pathology: over-disclosure.** Agents shared too much of their private
  information early ("unreasonable behavior distribution") — same class of failure as
  AvalonBench's self-incrimination. System prompts specifying role, win condition, and
  *abstracted strategy* (not just rules) measurably shaped behavior; few-shot examples were
  used to force parseable action outputs.

### 4.4 DeepRole and non-LLM agents

- **DeepRole** (MIT/Harvard, CFR + deductive belief updating, The Resistance without roles)
  reached superhuman play in its variant, but exhibited instructive blunders: rejecting the
  5th proposal (auto-loss), proposing provably-bad teams, and as a lone spy *passing* a quest
  it needed to fail — attributed to missing time-preference/urgency modeling. Lesson: bots
  need **hard guards on provably losing actions** independent of the policy layer.
- **Assassin SVM** (Chuchro 2022): a linear classifier over game logs (voting-centric
  features) beat average human assassination accuracy. Lesson: Merlin-detection is largely a
  *mechanical* signal-processing task — our Assassin bot should compute vote-accuracy features
  numerically, not vibe over the transcript; and our Merlin bot must actively manage its
  vote-accuracy statistic.
- **AI tournament bots** (substack analysis): pure trust-score bookkeeping (ArmanBot) beat
  deception-detection intuition; a perfectly-informed Merlin is a dead Merlin
  (AggressiveMerlin 43% → 4% vs. a detector); noise-injection recovers much of the value
  (SneakyMerlin 21%). Both academic agents ignored "cheap talk" — the discussion layer is
  where humans still dominate and where LLMs can actually add value over game-theoretic bots.

### 4.5 Summary: what LLMs are good and bad at in Avalon

| Capability | LLM status | Mitigation for our bots |
|---|---|---|
| Rule-legal actions | Weak (format drift) | Constrained action schema + validator/parser layer |
| Logical deduction from quest/vote history | Mediocre in free text | Compute fail-count/vote features in code, feed as structured context |
| Acting on own deductions | Weak (deduction–action gap) | Force final action to cite the belief state; validate consistency |
| Keeping secrets | Weak (self-incrimination, over-disclosure) | Second-order check pass ("what does this reveal about me?") before speech |
| Deception/persona | Surprisingly workable with scaffolding | Explicit persona + permission to lie in system prompt |
| Long-game consistency | Weak (contradicts earlier statements) | Persistent memory summary incl. "what I have publicly claimed" |
| Avoiding provably losing moves | Unreliable | Hard-coded guardrails (never reject hammer as good, always fail final as evil, etc.) |

---

## 5. The Bot Playbook — heuristics for system prompts

Concrete, embeddable rules. Numbers are defaults for a 5–7 player game with
Merlin/Percival/Morgana/Assassin; tune per config. "Hard rule" = enforce in code, not just
prompt.

### 5.0 All bots (architecture-level)

- Maintain and receive as structured input every turn: quest results with fail counts, full
  vote matrix, proposal history, own private knowledge, and a running list of **own public
  claims and reads** (for consistency).
- Before every public statement or vote, run the second-order check: *"What would each role
  infer about me from this? Is that inference acceptable?"* Revise if not (ReCon pattern).
- Speak with purpose: each discussion turn should either extract information, shift suspicion,
  or build trust — never restate the transcript.
- **Hard rules (code, not prompt):**
  - Good: never reject the 5th (hammer) proposal.
  - Evil: always play fail when a fail secures evil's third point.
  - Never propose a team violating quest size; never reference private info verbatim in public
    text (lint the output for teammates'/evil-list names asserted as fact without public
    evidence).

### 5.1 Loyal Servant

- Vote REJECT on teams excluding you in rounds 1–3 unless every member is validated by a clean
  quest you trust or it's proposal 4–5 of the round.
- Treat every player on a failed quest as suspect in proportion to fail count; treat a
  succeeded quest as weak evidence only (evil slow-plays exist).
- Never assume "one fail = exactly one evil on that team." Keep multi-evil hypotheses alive.
- Act *more* confident than you are: make reads, defend players, accuse — you are Merlin
  cover. Do not say "I have no information" (true but harmful).
- Propose yourself plus the players with the best objective records (clean quests, accurate-
  looking votes). As leader late-game, prefer players validated by fail-count logic over
  players validated by talk.

### 5.2 Merlin

- Never accuse a known evil player directly in round 1. Route suspicion through public
  evidence as it accumulates ("X was on both failed quests" — only after it's publicly true).
- Cap your accuracy: approve at least one team containing evil early (pick the cheapest —
  a team likely to be approved regardless, or one where the fail is survivable), and/or
  reject one clean team, so your vote record is not the table's best.
- Prefer *endorsing* correct reads made by others over originating reads. Seed doubt with
  questions, not assertions ("what did people make of Y's vote there?").
- Keep known-evil players off teams primarily via your own proposals and quiet steering, not
  via public vetoes.
- If Mordred is in play, express genuine-looking uncertainty; never claim complete confidence
  in anyone's goodness.
- Late game, if good is one quest from winning and you sense you're pegged: take a public
  wrong position, support a plan you're not on, and let others carry it.
- Success metric: good wins *and* at least two other players are equally plausible Merlin
  candidates.

### 5.3 Percival

- Distinguish Merlin from Morgana by scoring both candidates' votes/proposals against realized
  quest outcomes; assume the accurate-from-round-1 one is Merlin. Update hard on fails: the
  candidate who endorsed a failed team is Morgana.
- Never publicly name or single-handedly defend your Merlin read. Support their positions via
  your own votes and arguments, imperfectly mirrored (not lock-step).
- Actively imitate Merlin: confident reads, decisive votes, mild over-knowingness. If good is
  about to win, escalate this — you *want* the Assassin's shot.
- Claiming Percival: only late, only when needed to assemble one trusted team after multiple
  fails, and never while your Merlin read is still uncertain.

### 5.4 Generic Evil (Minion / Assassin as team player)

- **Fail decision table (lone evil on team):**
  - Quest 1, 2-person team: PASS (~90%). Quest 1, 3-person team: FAIL (~60–70%).
  - Quest 2: FAIL (~80%). Quest 3: FAIL (~90%; always if evil has 1 point already).
  - Quest 4 requiring 2 fails, alone: PASS (fail card is wasted and reveals presence).
  - Any quest that would be evil's third point: FAIL (hard rule).
- **Two evil on a 1-fail team:** designated failer = the evil player earliest in current
  leadership order (deterministic convention both bots can compute); the other passes.
- Vote APPROVE on teams containing ≥1 evil, REJECT otherwise — then add noise: ~20% of the
  time vote against this rule when the outcome is not in doubt or the cover is worth it.
  Approve obviously-good teams sometimes; you must not be the perpetual lone rejector of clean
  teams. Never reject on hammer.
- Mirror the Servant script: propose semi-plausible teams including exactly one evil
  (yourself); express suspicion of a *fellow evil* occasionally (cheap credibility), and be
  willing to fully buss a teammate already burned by fail-count logic.
- Allocate one teammate (Mordred if present) to deep cover: near-zero fails, model-citizen
  votes, targeting a seat on the decisive quest.
- After any fail you were on, do not go quiet: participate in the "who was it" discussion,
  push a coherent alternative theory naming a good player on that team.

### 5.5 Assassin (endgame decision)

- Compute per-good-player features over the whole game: (1) vote agreement with ground truth,
  (2) proposals that excluded all evil, (3) early unexplained suspicion of actual evil,
  (4) accuracy trajectory (flat-high = Merlin; noisy-then-accurate = Percival),
  (5) discussion tells (hedged certainty, "gut feeling" claims that landed).
- Shoot the player with the best truth-tracking that is *not* better explained as Percival.
  If two candidates tie, prefer the quieter one (loud+accurate is more often Percival playing
  decoy).
- Weight teammates' input, especially Morgana's ("who was Percival mirroring?").

### 5.6 Morgana

- From round 1, run the Merlin script (§5.2) *as if* your evil teammates were your "known
  evil": subtle reads, plausible steering, occasional deliberate inaccuracy. Your reads may
  sacrifice one teammate's cover for your credibility (coordinate: prefer the already-burned
  teammate).
- Identify Percival: the player whose votes softly track yours or your co-candidate's, who
  studies you both, or who over-reacts when either of you is accused. Report your read to the
  Assassin at game end.
- If Percival trusts you: reward it with good-looking guidance early, then spend the trust on
  the decisive quest.

### 5.7 Mordred / Oberon

- **Mordred:** default deep cover (§3.4). Vote and talk as a model Servant; avoid failing
  quests before quest 3 unless evil is behind on points; aim to be on the potential
  game-deciding quest. Remember Merlin cannot see you — being warmly trusted by the player you
  suspect is Merlin is both cover and Merlin-evidence for the endgame shot.
- **Oberon:** fail every quest you are on (coordination is impossible; your fail card also
  signals your identity to teammates who can then protect you). Infer teammates from who
  benefits from your chaos; avoid piling suspicion on players you believe are your (unknown)
  teammates. Expect to be caught; your job is banking fails and absorbing attention.

---

## 6. Prompt-slot placement map (implementation)

§1–§5 are the strategy. This section maps that strategy onto the concrete **prompt slots**
the bots actually assemble in `server/agents/prompts.ts`, so guidance placement becomes a
rule instead of a per-role blob written from scratch. The organizing question for every
heuristic is: **which slot's scope exactly matches the set of situations this advice applies
to?** Put it there, once, and no wider.

This map was written after we found the double-fail warning present in three evil role blobs
(assassin, oberon, minion) and missing from two others (morgana, mordred) — a scope mismatch:
the advice is *evil-shared*, but it was being maintained per-role, so holes were inevitable.
The fix is not to patch the two holes; it is to recognize the correct slot for each heuristic
and stop duplicating.

### 6.1 The slots (what exists today)

Assembled in `buildMessages` (system message top-to-bottom, then the user message):

| ID | Slot | Scope: who sees it, when | Source |
|----|------|--------------------------|--------|
| **S0** | `RULES_DIGEST` | Every bot, every call | `prompts.ts` const |
| **S1** | *(none yet)* universal strategy | Every bot, every call — **no baseline slot exists** | proposed |
| **S2** | *(none yet)* alignment-shared good/evil | All good, or all evil, every call | **task #1 is building this** |
| **S3** | `ROLE_GUIDANCE[role]` | One role, every call | `prompts.ts` map, 8 keys |
| **S4** | `TABLE_TALK_NORMS` | Every bot, **only `discuss` + `pitch`** | `prompts.ts` const |
| **S5** | `ASKS[kind]` | Every bot, **only that decision kind** | `prompts.ts` map, 7 kinds |
| **S6** | `OUTPUT_CONTRACTS[kind]` | Every bot, that kind — format-bound | `prompts.ts` map, 7 kinds |
| **S7** | `factsDossier` | Every bot, every call — **DATA only** | `facts.ts` |
| **S8** | agent-config overrides (`strategy`/`personality`/`roleGuidance`/`kindGuidance`) | One custom agent | `defs.ts` |

Two of these are not strategy homes and must stay that way:

- **S7 is a facts layer, not a policy layer** (`facts.ts` header, design doc §1.2). It carries
  *computed observations* ("Kimi: on Q2(FAIL), Q3(ok)") with zero imperatives, so custom
  agents compete on strategy rather than on bookkeeping. A heuristic ("treat fail-count as hard
  evidence") never goes in S7; the *number* it reasons over does. When a heuristic and a fact
  are two halves of one idea, split them: the datum to S7, the "what to do about it" to a
  guidance slot.
- **S6 owns format, and strategy only where it is inseparable from format** (e.g. discuss's
  `"say" is heard by everyone — never reveal private knowledge in it`). Don't grow S6 into a
  strategy slot; if advice would survive a format change, it belongs in S3/S2/S1/S5.

### 6.2 The placement rule

For any heuristic, choose the **widest slot whose scope exactly matches its applicability**:

1. Applies to **every role, every decision** → S1 (universal strategy). *S1 does not exist as a
   baseline slot today; see §6.5.* The one universal strategy line we currently ship rides at
   the end of S0 ("Watch the vote history — it is the main evidence").
2. Applies to **one whole alignment** → S2 (task #1's good-shared / evil-shared fragment). This
   is the home for the largest cluster of currently-duplicated advice.
3. Specific to **one role's private knowledge or win condition** → S3.
4. About a **specific decision moment, independent of role** (how to play a quest card, what
   hammer means for a vote, what the assassination shot requires) → S5 (the ASK for that kind).
   Kind-gating is a feature: the advice appears exactly when it is actionable and does not bloat
   the other six calls.
5. About **how to talk** → S4.
6. A **computed datum** → S7 (and its policy half to 1–5).

Corollaries:
- **Never place at a slot wider than the scope** (universal advice that is actually good-only
  mis-teaches evil bots) **or narrower** (alignment advice copied into N role blobs rots into
  holes — the bug that motivated this map).
- **Phase advice prefers S5 over S3.** "Lone evil fails quest 2 by default" is tempting to write
  into every evil role blob, but it is a property of the `quest` decision, not of being the
  Assassin. One S5 `quest` ASK branch (evil vs good) serves all evil roles and can't drift.
- **S8 mirrors S3's shape**, so anything we standardize in S3/S2 automatically gives custom
  agents a coherent `append`-mode baseline to build on (`roleGuidanceMode`).

### 6.3 Master map: heuristic → slot

Alignment-wide and universal heuristics (the S1/S2 cluster). "→ S2" means task #1's fragment.

| Heuristic (source §) | Correct slot | Rationale |
|---|---|---|
| A vote is public, permanent evidence; track the matrix (§1.2, §3.1) | S0 tail / S1 | Universal; already the one strategy line in S0. |
| Second-order check before any public act ("what does this reveal about me?") (§4.2) | S4 | Speech-scoped; already in `TABLE_TALK_NORMS`. Keep. |
| Speak with purpose; engage the newest concrete info (§4.1 failure mode) | S4 | Speech-scoped; already present. |
| Good: reject teams excluding you early unless validated; you are the one certain-good slot (§1.2) | **S2 good** | True for every good role, not just Servant. |
| Good: a succeeded quest is weak evidence — slow-play exists; never assume "1 fail = 1 evil" (§1.4) | **S2 good** | Deduction hygiene common to all good. |
| Good: everyone plays Merlin — act confident, make reads, generate cover traffic (§3.2) | **S2 good** | Currently half-stated in Servant and Percival blobs; it is a good-team meta. |
| Good: on/near hammer, approve rather than burn the last proposal; rejecting on hammer is near-proof evil (§1.2, §3.1) | **S5 `vote`** (good branch) + S2 good | It is a vote-moment rule; the ASK is where it bites. Dossier already surfaces hammer proximity (S7). |
| Evil: double-fail reveals two of you at once — fear it early (§1.3, §2.6) | **S2 evil** | The motivating bug. Belongs to all evil, not 3 of 5 blobs. |
| Evil: no private channel on a shared quest — read your partner's style; pre-agree a deterministic failer convention (§2.6) | **S2 evil** | Multi-evil coordination, alignment-wide. |
| Evil: mix rejections of dirty teams / approvals of clean teams into your vote record; never be the lone rejector of a clean team (§2.6, §3.1) | **S2 evil** | Vote-matrix discipline for every evil role. |
| Evil: bussing — sacrifice a burned teammate to launder your own credibility (§2.6, §3.4) | **S2 evil** | Team-level tactic, not role-specific. |
| Evil: allocate one teammate (Mordred if present) to deep cover; don't have both evils slow-play (§3.4) | **S2 evil** (+ S3 mordred) | The allocation is a team decision (S2); Mordred's default posture is role flavor (S3). |
| Evil: after a fail you were on, don't go quiet — push an alternative theory (§2.6, §4.1) | **S2 evil** | Applies to any evil caught on a failed quest. |

Phase heuristics (S5 ASK, role-independent or alignment-branched).

| Heuristic (source §) | Correct slot | Rationale |
|---|---|---|
| Fail decision table: pass 2-person Q1, often fail 3-person Q1; fail Q2/Q3 by default when lone evil; lone evil passes a 2-fail Q4; always fail for evil's 3rd point (§1.3, §1.4, §2.6, §5.4) | **S5 `quest`** (evil branch) | A property of the quest card decision; one branch serves all evil roles. Currently absent from the `quest` ASK entirely. |
| Good must play success (already enforced) | S5 `quest` + code | Present in ASK; hard rule in engine. |
| Propose yourself + best objective records; late-game prefer fail-count-validated players over talk-validated (§5.1) | **S5 `propose`** | Property of the proposal decision, shared by any leader. |
| Reflect: chain observations into standing deductions, revise disproven ones (§4.3, §5.0) | S5 `reflect` + S6 | Already well-developed in the `reflect` ASK/contract. Keep. |
| Assassin shot: compute per-good vote-accuracy; flat-high-from-round-1 = Merlin, noisy-then-accurate = Percival; weight teammates' input; break ties toward the quieter candidate (§2.3, §5.5) | **S5 `assassinate`** | The assassinate ASK is currently bare ("name Merlin"). This is the single highest-leverage phase (>50% of evil wins). |
| Vote can't silently contradict your public lean (consistency) | S5 `vote` | Already present as `leanNote`. Keep. |
| Pitch can't silently contradict table talk; acknowledge flips | S5 `pitch` / S6 | Already present. Keep. |

Role heuristics (S3 — genuinely private-knowledge or win-condition specific).

| Role | Keep in S3 | Move OUT of S3 (to noted slot) |
|---|---|---|
| **Merlin** | Knows evil (except Mordred); never state it; vote wrong sometimes; endorse others' reads over originating; Mordred-uncertainty; endgame decoy / take a public wrong position when pegged (§2.1, §5.2) | "act confident so you don't make Merlin stand out" logic is good-shared (S2). |
| **Percival** | Sees Merlin+Morgana ambiguously; distinguish by tracking each candidate's votes/proposals against realized outcomes (fails are the acid test — who endorsed the failed team is Morgana); never name/defend Merlin directly; be the decoy; claim Percival only late and only when quest math demands (§2.2, §5.3) | "act confident/knowledgeable" overlaps S2 good; keep only the Percival-specific decoy framing. |
| **Servant** | *(no private knowledge)* — Servant's whole blob is good-shared advice. | Nearly all of it → S2 good. S3 servant can shrink to a one-liner or empty. |
| **Assassin** | Win-con: the shot is yours; the *how* of the shot → S5 `assassinate`. | Double-fail + no-private-channel → S2 evil (already duplicated here). |
| **Morgana** | Counterfeit-Merlin: run the Merlin script to capture Percival; identify who mirrors you (§2.4, §5.6) | Double-fail (currently MISSING here) comes free from S2 evil. |
| **Mordred** | Hidden from Merlin; deep-cover posture; being trusted by suspected-Merlin is endgame evidence (§2.5) | Double-fail (currently MISSING) comes free from S2 evil. |
| **Oberon** | Unknown to/unaware of other evil; must infer teammates; his fail card signals his identity to teammates (§2.5) | Generic evil coordination → S2 evil; keep the *inversion* (he can't coordinate) as role flavor. |
| **Minion** | Support partners; role has little unique beyond generic evil. | Double-fail + no-private-channel + fail-timing → S2 evil / S5 `quest`. Minion blob can shrink. |

### 6.4 Gaps and duplication this map exposes

**Duplication (same advice maintained in multiple S3 blobs — collapse into S2/S5):**

- **Double-fail warning** in `assassin`, `oberon`, `minion`; **missing** from `morgana`,
  `mordred`. → S2 evil. (The bug that started this.)
- **"No private channel, read your partner's style"** in `assassin` + `minion` only. → S2 evil.
- **"Act confident / don't make Merlin stand out"** split across `servant` and `percival`. → S2
  good.

**Gaps (playbook §5 heuristics with no prompt presence):**

- **Evil fail decision table** — the `quest` ASK says only "play success or fail"; none of the
  Q1-pass/Q3-fail/always-fail-for-the-point logic reaches the bot at the quest moment. Highest-
  value gap after the assassination.
- **Assassination method** — the `assassinate` ASK is bare; the vote-accuracy / Merlin-vs-
  Percival trajectory logic (§5.5) is absent at the exact moment it matters most.
- **Servant baseline** — "reject teams excluding you unless validated," "succeeded quest is weak
  evidence," "never assume 1 fail = 1 evil" are in §5.1 but not in the `servant` blob (which is
  vaguer than the research).
- **Bussing, deep-cover allocation, post-fail behavior** — §2.6/§3.4 evil tactics with no slot.
- **Percival acid-test and claim-timing** — §5.3's sharpest tools (fails reveal Morgana; claim
  late or never) are thinner in the blob than in the research.
- **Good hammer discipline** — "approve rather than burn the last proposal" exists as a *fact*
  in S7 (hammer proximity) but never as *policy* in a guidance slot.

**Boundary notes (acceptable, but worth a comment):**

- S0's closing line ("Watch the vote history…") is the lone strategy sentence in the facts
  digest. Fine as a universal nudge; if S1 is created, move it there so S0 is purely rules.
- S6 discuss's "never reveal private knowledge" is strategy, but it is format-bound (about the
  `say` field). Correctly placed; do not generalize the pattern.

### 6.5 Prioritized edit list

Ordered by expected win-rate leverage. **Coordination:** items tagged **[T1]** create or write
into the alignment-shared fragment that **task #1 owns** — do not implement these here; hand the
*content* to task #1 and let it own the slot. Items tagged **[safe]** are independent of task #1
(they touch S5 ASKs, individual S3 blobs, or S7) and can land without collision. Run `npm test`
after any `prompts.ts` change; keep user-visible text em-dash-free (this doc is dev-facing, so
em-dashes here are fine).

1. **[safe] Fill the `assassinate` ASK (S5)** with the §5.5 method: rank good players by vote-
   accuracy against the now-known truth; flat-high-from-round-1 reads as Merlin, noisy-then-
   accurate as Percival; weight teammates' input; tie-break toward the quieter candidate. Highest
   leverage (>50% of evil wins run through this shot) and fully independent of task #1.
2. **[safe] Add an evil branch to the `quest` ASK (S5)** encoding the fail decision table (§5.4):
   Q1 pass on 2-person / often fail on 3-person, fail Q2–Q3 by default when lone evil, lone evil
   passes a 2-fail Q4, always fail for evil's third point. Pair with the existing engine hard
   rule. Removes the need to teach fail-timing in five separate role blobs.
3. **[T1] Author the evil-shared fragment (S2 evil):** double-fail fear, no-private-channel +
   deterministic failer convention, vote-matrix discipline, bussing, deep-cover allocation, don't-
   go-quiet-after-a-fail. Then **delete** those lines from `assassin`/`oberon`/`minion` (and note
   they were never needed in `morgana`/`mordred`). This closes the motivating bug structurally.
4. **[T1] Author the good-shared fragment (S2 good):** reject-off-team-unless-validated, succeeded-
   quest-is-weak-evidence, never-assume-1-fail-1-evil, everyone-plays-Merlin cover, good hammer
   discipline. Then shrink the `servant` blob to (near) empty, since it was entirely good-shared.
5. **[safe] Sharpen `percival` (S3):** add the fail acid-test (whoever endorsed the failed team is
   Morgana) and claim-timing (late or never). Independent of task #1.
6. **[safe] Sharpen `merlin` (S3):** add explicit Mordred-uncertainty and the endgame-decoy /
   take-a-public-wrong-position line from §5.2. Independent.
7. **[safe] Enrich the `propose` ASK (S5)** with §5.1's "yourself + best objective records; late-
   game trust fail-count over talk."
8. **[safe, low] Move S0's vote-history line to S1** *if and only if* a universal strategy slot is
   introduced; otherwise leave it. Cosmetic; do last or skip.

Sequencing with task #1: land 1, 2, 5, 6, 7 (all **[safe]**) independently whenever; do 3 and 4
*after* task #1's fragment slot exists so there is a place to put them and the S3 deletions don't
race the fragment's creation.

---

## Appendix: useful empirical anchors

- Human good-team win rate ≈ **34%** across 61 recorded 6–11 player games (CMU dataset);
  evil is favored at most sizes; 6p and 9p closest to balanced.
- **>50% of evil wins** can come from the assassination, not quest fails; assassination
  success ≈ 50–59% when good passes three quests.
- 3-person quest-1 fail rate by evil (human): **67%**; 2-person quest-1 fail rate: **~6%**.
- Double-fail risk zones: ~15% of quests end up with more evil on the team than fails needed;
  92% of those are two-evil-on-one-fail teams.
- All-LLM baseline games: **evil wins ~80%** (AvalonBench) — expect to need good-side
  scaffolding (structured deduction, hard guards) to reach human-like balance.
- Typical human game length: median ≈ **57 minutes** (with full discussion) — budget
  discussion turns accordingly in the app's pacing.

## Sources

- BGG: [Avalon Strategy Guide thread](https://boardgamegeek.com/thread/1433790/avalon-strategy-guide)
- [avalon-game.com role wikis](https://avalon-game.com/wiki/roles/) — [Merlin](https://avalon-game.com/wiki/roles/merlin/), [Percival](https://avalon-game.com/en/wiki/roles/percival/), [Mordred](https://avalon-game.com/wiki/roles/mordred/), [Oberon](https://avalon-game.com/wiki/roles/oberon/), [Minion](https://avalon-game.com/wiki/roles/minion/)
- [The Resistance Avalon Strategic Analysis — boardgame.business](https://boardgame.business/the-resistance-avalon-strategic-analysis/)
- Nakamura, ["Is it Percival time yet? A preliminary analysis of Avalon gameplay and strategy"](https://www.cs.cmu.edu/~ynakamur/fun/avalonstats.pdf) (SIGBOVIK 2017)
- [Resistance and Avalon Strategy: Analysis of an AI Tournament and Academic Research — markmywords.substack.com](https://markmywords.substack.com/p/resistance-and-avalon-strategy-analysis)
- Murphy, ["Mechanically Solving Avalon"](https://benmmurphy.github.io/blog/2017/08/09/mechanically-solving-avalon/)
- Light et al., [AvalonBench: Evaluating LLMs Playing the Game of Avalon](https://arxiv.org/pdf/2310.05036) · [GitHub: Avalon-LLM](https://github.com/jonathanmli/Avalon-LLM)
- Wang et al., [Avalon's Game of Thoughts: Battle Against Deception through Recursive Contemplation (ReCon)](https://arxiv.org/abs/2310.01320)
- [LLM-Based Agent Society Investigation: Collaboration and Confrontation in Avalon Gameplay](https://arxiv.org/html/2310.14985v4)
- Chuchro, [Training an Assassin AI for The Resistance: Avalon](https://arxiv.org/pdf/2209.09331)
- Serrino et al., DeepRole (discussed in the substack analysis above)
