# Visual redesign — direction, vocabulary, and work tracker

Status: **direction chosen, implementation not started.** This doc is the single place to
track what the redesign covers, what has landed, and what is deliberately deferred.

Process so far (July 2026): screenshot audit of the live app → design brief → 7 divergent
mocks of the same mid-vote scenario → blend rounds → **"The Arcane Table"** direction plus
a full tarot card system ("The AvaLLM Arcana"). Mock sources live in [`docs/mocks/`](mocks/)
— each is a self-contained HTML file; open in a browser, resize below 720px for the mobile
layout. All mocks render the identical game state (7 players, Q1 won, Q2 failed, voting on
Kimi·Allen·Haiku, you = Servant) so they compare fairly.

## Goals (the brief)

- **Highly usable AND interesting.** Neither wins alone.
- **Mobile is a first-class target.** Every screen must work at 390×844.
- **All-out immersive mode** (art, heavy animation) is **deferred** — design so it can be
  added later without rework, but do not build it now.
- Keep: the screen decomposition, the history grid, the copy voice ("mail chess"), the
  model badges, dark-only.

## Chosen direction: The Arcane Table

High Table's chassis wearing The Reading's skin. Midnight indigo + starfield + antique
gold; the far side of the table as a top arc with the six opponents as small **arcana
cards** standing behind it; the quest line as a **five-card spread lying on the felt**
(face-down = future, flipped = resolved, glowing = current); the conversation feed below;
your place setting at the bottom edge with votes **played as cards from your hand**.

Mocks (repo file + published artifact):

| Mock | File | Artifact | Status |
| --- | --- | --- | --- |
| **G · The Arcane Table** (game, mid-vote) | [mock-arcane-table.html](mocks/mock-arcane-table.html) | [link](https://claude.ai/code/artifact/3ee5f644-68ab-4a7e-b1a8-a37c495078b5) | **selected** |
| **G · Arcane setup/landing** | [mock-arcane-setup.html](mocks/mock-arcane-setup.html) | [link](https://claude.ai/code/artifact/6fb87aba-a523-46a5-8c25-62227c5dc341) | **selected** |
| **The AvaLLM Arcana** (card system specimen) | [arcana-specimen.html](mocks/arcana-specimen.html) | [link](https://claude.ai/code/artifact/80636257-626d-4e87-9c7b-fe40738646d2) | **reference — canonical card anatomy + emblems** |
| A · The Round Table (immersive scene) | [mock-roundtable.html](mocks/mock-roundtable.html) | [link](https://claude.ai/code/artifact/a2d62ca2-4d31-4e0b-9efe-443a996dc375) | archive; source of vote-token physicality, future immersive mode |
| B · Ledger & Lamplight (refined skeleton) | [mock-ledger.html](mocks/mock-ledger.html) | [link](https://claude.ai/code/artifact/c90ffa99-5152-4d52-ad9c-07110ee9dc38) | archive; feed differentiation largely absorbed into G |
| A+B · High Table | [mock-hightable.html](mocks/mock-hightable.html) | [link](https://claude.ai/code/artifact/89e01de2-984d-44e4-88c4-1672513639b6) | superseded by G (G = this chassis + tarot skin) |
| D · The Illuminated Chronicle (light parchment) | [mock-manuscript.html](mocks/mock-manuscript.html) | [link](https://claude.ai/code/artifact/d91c59f0-3dd5-421c-8c02-ba06abb6d398) | archive; wax-seal vote physicality worth stealing |
| E · The Machine Court (terminal) | [mock-terminal.html](mocks/mock-terminal.html) | [link](https://claude.ai/code/artifact/5bbdc030-c5b4-44db-93a8-3c464a452403) | archive; flag-chip seat states + density → history/record views |
| F · The Reading (tarot) | [mock-tarot.html](mocks/mock-tarot.html) | [link](https://claude.ai/code/artifact/93c2abf9-33a3-4479-9f3c-0d00afcb98f3) | absorbed into G |

Design audit (annotated screenshots of the current app, finding IDs used below):
[artifact](https://claude.ai/code/artifact/a2603952-285d-4cff-a177-0d4e287ad0b4). Screenshots are
regenerable — see "Tooling" at the bottom.

## The AvaLLM Arcana (card vocabulary)

Canonical anatomy lives in [arcana-specimen.html](mocks/arcana-specimen.html): numeral
cartouche, engraved emblem in an oval frame, title plate, corner stars. Emblems are
60×60 stroke-only SVGs (recolor via `currentColor`, scale from 12px chips to full cards).

| Card | Numeral | Emblem | Notes |
| --- | --- | --- | --- |
| Merlin — **The Seer** | I | eye | |
| Percival — **The Watcher** | II | shield + twin stars | sees two seers |
| Servant — **The Loyal** | III | chalice | |
| Assassin — **The Knife** | XIII | dagger | Death is XIII |
| Morgana — **The Mirror** | XVIII | facing crescents | The Moon is XVIII |
| Mordred — **The Veiled** | XV | shrouded crown | The Devil is XV |
| Oberon — **The Stranger** | IX | lantern | The Hermit is IX |
| Quest success — **The Sun** | XIX | sun | quest card flips to this |
| Quest fail — **The Tower** | XVI | struck tower | fail count on title plate |
| Spectator — **The Witness** | 0 | open book | unaligned; the Fool's position |
| Seat sigils — **celestial bodies** | — | ☿ ♊ ☉ ☽ ♃ ♄ … | pick O2 (2026-07-23): each agent is a body in the constellation, brand-colored; humans are ⊕ Earth; autopilot is ⚙ the Clockwork; custom agents draw deterministically from the outer pool (`celestialFor` in Arcana.tsx). Unicode for now — converting the chosen set to SVG is an open polish item. |
| Vote approve | AYE | laurel | also good's forced Success card |
| Vote reject | NAY | dagger | |
| Leader marker | ♛ | crown | passes clockwise |

Roman-numeral in-jokes are intentional; role *names* in prose stay the standard Avalon
names (Merlin, Percival…) — the arcana titles are the cards' display dress, not renames.

## Tokens (draft — extract into `client/src/styles.css` as CSS custom properties)

- **Palette**: night `#14112a` · night-2 `#1b173a` · panel `#201c42` · line `#363057` ·
  bone `#eae2d0` / dim `#a7a094` / faint `#6f6a84` · gold `#c9a84c` (deep `#8a7230`) ·
  lapis (good) `#6f8fd9` · oxblood (evil) `#c25e54` · lacquer wood `#201625`/`#322238` ·
  felt `#1c2138`. Model brand colors: ds `#6b83ff`, gm `#4fb39c`, hk `#e08a67`,
  km `#45c4d8`, gl `#a97fe6`, gp `#67b377`.
- **Color roles**: gold = structure/attention/leader; lapis & oxblood = allegiance ONLY
  (fixes audit X2); model colors = identity chips/ticks.
- **Type**: display + body `Constantia, "Palatino Linotype", Georgia, serif`; records,
  labels, model slugs `Consolas / Cascadia Mono` (machine voice). Small-caps + tracked
  uppercase for plates and labels.
- **Components**: tarot card (3 tiers: full role card / seat card / mini quest card),
  gem (rotated square; vote lean + role toggles), cartouche, moment divider, record line
  (mono, gold left rule), speech block with model-color tick, table arc surface, play-card
  buttons, gold CTA rail.

## Work tracker

Audit finding IDs: see the audit artifact. `[ ]` = not started.

### Core (the redesign proper)

- [x] **M1 bug: mobile in-game horizontal overflow/clipping** — fixed structurally:
  `html, body { overflow-x: clip }` plus `min-width: 0` on flex children in the rebuilt
  layout; verified via full playthrough at 390×844.
- [x] Extract tokens into `client/src/styles.css`; emblem sprite + role mapping live in
  `client/src/components/Arcana.tsx` (rendered once from `main.tsx`).
- [x] **Game screen**: table arc + arc-positioned seat cards (G4), quest spread with
  Sun/Tower faces (G2), differentiated feed — speech/record/moment, win reasons in plain
  words (G3), role card as arcana (G6), play-card vote/quest actions with turn tags (G5),
  mobile pinned your-edge bar + compact role strip (M2). Seat arc positions are
  percentages of the zone, so the arrangement compresses with the viewport.
- [x] **Setup/landing** (G setup mock): dealt-cards hero (real quest sizes per player
  count, 2-fails marker), numbered panels The Table / The Seats / The Roles, seat rows
  with mini card-backs and untruncated blurbs (S4), gem role toggles (keyboard-focusable),
  fixed gold CTA rail with the live in-play roster (S1–S5).
- [x] **Endgame reveal** (E1/E2, M3): the reveal replaces the feed stage (the table arc
  stays as backdrop); every identity dealt face-down in seat order and flipped one by one
  (staggered 0.35s); winner banner in plain words; your card outlined in gold; thinking
  timeline behind the same toggle.
- [x] **History grid + Reference modals** (G7): Record / Codex ghost buttons (X3), sheets
  on the token system, grid gets mono type, uppercase headers, row hover, gold on-team
  shading. (A deeper flag-chip redesign of the grid stays a future option.)
- [x] Motion pass (X4): quest-card flip on resolve, feed rows lay in, moments scale in,
  reveal deal-and-flip, current-card glow, turn-tag pulse, play-card hover lifts — all
  disabled under `prefers-reduced-motion`.
- [x] Verify with a real playthrough via the screenshot harness — done for the game
  screen at 1280×800 and 390×844 (autopilot game, all phases through reveal).

### Lower priority

- [ ] Lobby / join screens in the language (tokens only so far — hero/panel layout pass
  still open).
- [x] Custom-agent form styling (panelized, "Inscribe your own agent"); spectator chrome
  (◎ chip at the near edge).
- [x] Vote tally as a row of played cards in the feed — per-player aye/nay chips with the
  result stamp.
- [x] Degraded-bot note, error/reconnect banner styling (mono, oxblood rule, in the edge
  rail).
- [x] Feedback pass (2026-07-23, Allen): transcript rebuilt to match the mock
  (model-colored speaker names + slug, block layout, bordered lean chips); legibility
  pass on the table zone (labels up 1–2px, `--faint`→`--dim`, blur shadows removed);
  8–9 player tables get a `crowded` seat tier verified at 9 players both viewports.

### Screenshot gallery (tooling)

`node tools/screenshots.mjs` (after a client build) spawns its own server and captures
every hard-to-reach state — setup variants, all game phases, Record/Codex sheets, the
reveal, lobby host / join / in-game spectator — at desktop 1280×800 and mobile 390×844
into **`docs/screens/`** (committed). Regenerate on demand before/after design commits,
not per commit. Games are unseeded on purpose: a client-chosen seed would determine the
hidden role deal, so pixel-stable runs would need an engine-side gated seed path (future).
TODO: an error/reconnect-banner capture.

### Table surface — DECIDED: The Constellation (ambient scene)

The felt-and-lacquer ellipse read "poker" (Allen). Alternatives were explored
([surfaces](https://claude.ai/code/artifact/75f9f772-8a0e-4e5d-87d8-0152615faa66),
[constellation variants + motion](https://claude.ai/code/artifact/4d60cb73-268b-4a5e-9006-acaa3ff32980));
**picked and implemented 2026-07-23: the ambient Constellation** — golden orbit lines,
travelling mote, live twinkles, slow staggered seat bob, pulsing leader halo. Motion
verdicts from Allen: speaking ripple **rejected**, quest comet **rejected** (the card
flip alone carries it), gem-drop on lean **adopted** (fires on post-proposal lean
signals), your-turn edge sweep + hand rise **adopted**. Sub-variants Orrery/Zodiac
remain future options (Zodiac's seat-linking lines double as a turn-order diagram).

### Feedback rounds (2026-07-23, post-push)

- [x] Custom scrollbars (thin, gold on grab).
- [x] Quest-card legibility: **A1** (62×88) shipped; **A2 tally plaque** shipped
  mobile-only (spread stacks: cards row, proposal + tally beneath) — awaiting veto.
- [x] **Arcane tooltips**: seat cards (status / lean / last vote / leads-in-N / blurb,
  side-placed to dodge the arc clip — note `.farseats`' transform makes it an atomic
  stacking layer, hence the `:has(:hover)` z-index lift) and quest cards (past = who
  went + fails revealed; future = team size + fails needed). Declutter: model slugs,
  next-♛ tag, and the 2-fails label moved into hover; tooltips off on touch.
- [x] **Play cards to specimen parity**: full anatomy at 112×150 (cartouche, oval
  emblem frame, bordered title plate, corner stars, radial sheen), rising above the
  edge. Root cause of the quality gap: button-scale cards had dropped four anatomy
  layers and starved the emblems below their stroke-density floor (~30px).
- [x] **Seat sigils → O2 celestial bodies** (see arcana table above).
- [x] Full-bleed table zone (game container un-capped; chrome/main center at 1400px).
- [x] Error/reconnect banner: floating comet-marked toast above the edge rail.
- [x] Input section: framed lean group with AYE/NAY/? chips (same vocabulary as seats
  and feed), gold Say, ghost Pass.
- [x] Quest tooltip counter-rotates out of the card's 3D tilt (reads flat).
- [x] Landing dealt-cards match the in-game quest-back face (number in a gold ring).
- [x] **T1 thinking indicator**: ghost row at the feed's live edge (agent's celestial
  glyph + name in brand color, "is thinking", pulsing dots) for bots mid-decision;
  only visible during real LLM latency, not autopilot.
- [x] Full-bleed follow-ups: footer content re-centered to 1400px (bar stays full-bleed
  as the table edge); orbit given a FIXED aspect + centered max-width so widening no
  longer flattens the arc (it sits under the seats at every width; mobile keeps a
  rounder aspect); a bottom fade scrim dissolves the descending orbit arcs into the
  night instead of a hard clip where the zone meets the feed.
- [x] Quest cards flattened (dropped the vestigial `rotateX(14deg)` felt-tilt now that
  there is no felt) — fixes the slanted quest tooltip at the root and matches seat cards.
- [x] Mobile tally plaque **vetoed** and removed (markup + CSS).
- [x] **Phase-aware live-edge indicators** (`PendingIndicator` in Feed, keyed on
  `view.phase`): discussion/proposal keep the ghost row; **vote → sealing ballot**
  (per-voter slots, sealed shows ✦ never the value, resolves to the attributed tally);
  **quest → Q1 gather-&-shuffle ballot** (face-down cards per team member collapse and
  shuffle when all sealed — anonymity by gathering — then the questResult moment reveals
  only the fail count); **assassination → the dread beat** ("⚔ The Knife is drawn"). Ghost
  row stays for sequential speech only. Vote is public/attributed, quest is anonymous —
  the two ballots share the sealing stage and diverge at resolution.
  Follow-up noted: ballots read all-sealing→reveal (server resolves bots together); a live
  "3/7" trickle needs per-decision broadcasts.
- [x] **Dev-only bot-decision delay** (`AVALON_BOT_DELAY_MS`, 0/off in prod) holds the
  `acting` state so the screenshot harness can capture the transient thinking/ballot/beat
  UI. Gallery now captures vote-ballot, quest-ballot, discuss-thinking, assassin-beat at
  both viewports; the `vote-thinking.html` / `quest-ballot.html` design previews are in
  `docs/mocks/`.

### Exploratory / future (design for compatibility, don't build yet)

- [ ] **Immersive mode**: full Round Table scene (mock A) as a toggle; the arc is the
  compatibility hook — it can grow into the full ellipse.
- [ ] **Reversed cards**: long-press a seat to mark private suspicion; their card renders
  upside-down for you alone (tarot reversal = inverted meaning).
- [ ] Card-back variants per game / per agent library entry.
- [ ] Light "Illuminated Chronicle" theme (mock D) as an alternate skin.

## Tooling

Browser-pane screenshots were unreliable, so audits/verification use a Puppeteer harness
(`npm i puppeteer-core`, Chrome at the default Windows path). The game harness plays a
full autopilot game through the real UI and screenshots every state at 1280×800 and
390×844; a sibling script screenshots the mock HTML files. Both currently live in the
session scratchpad (`audit.mjs`, `shoot-mocks.mjs`) and are ~150 lines to recreate; copy
into `tools/` when step "verify" begins. Gotchas: modals close via `.ref-close` (not
Escape); React inputs need the native value setter + an `input` event; game screens are
not deep-linkable, so the harness clicks through the launcher.
