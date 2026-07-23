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
- [ ] **Setup/landing** (G setup mock): dealt-cards hero, three numbered panels, gem role
  toggles, sticky gold CTA rail (S1–S5 all addressed in mock). Currently wearing an
  interim token skin only — layout still the old single column.
- [ ] **Endgame reveal** (E1/E2, M3): reveal takes over the stage; seven arcana dealt
  face-down in seat order, flipped one by one; winner banner in plain words; thinking
  timeline restyled (scratchpad/notes rows). The card-flip is the core animation.
- [ ] **History grid + Reference modals** (G7): header buttons are now Record / Codex
  ghost buttons (X3 partly done) and the sheets inherit the tokens; the grid's
  flag-chip density pass is still open.
- [ ] Motion pass (X4): current-card glow, thinking pulse, and play-card hover lifts are
  in (all behind `prefers-reduced-motion`); card flips (quest + reveal) and vote tally
  lay-down still open.
- [x] Verify with a real playthrough via the screenshot harness — done for the game
  screen at 1280×800 and 390×844 (autopilot game, all phases through reveal).

### Lower priority

- [ ] Lobby / join screens in the language (currently plain `.landing` reuse).
- [ ] Custom-agent form styling; spectator chrome.
- [ ] Vote tally as a row of played cards in the feed (specimen "usage" note).
- [ ] Degraded-bot note, error states, reconnect banner styling.

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
