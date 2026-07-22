# The Resistance: Avalon — Rules & Visual Design Research

Research for an AI-powered Avalon where a human plays with/against LLM-driven bots.
Compiled 2026-07-22 from the official rulebook (via RulesPal/UltraBoardGames transcriptions), avalon-game.com (avalon.fun) wiki, and ProAvalon.

---

## 1. Game overview

*The Resistance: Avalon* (Don Eskridge, Indie Boards & Cards, 2012) is a standalone re-theme of *The Resistance* (2009). 5–10 players, no player elimination, ~30 minutes. Players are secretly dealt Good (Loyal Servants of Arthur) or Evil (Minions of Mordred) roles. Good wins by succeeding 3 of 5 Quests; Evil wins by failing 3 Quests, by deadlocking a round with 5 rejected team proposals, or by assassinating Merlin after Good's third success.

Differences from parent game *The Resistance*: Avalon adds the information roles (Merlin, Percival, etc.) and the assassination endgame; *The Resistance* instead uses Plot cards for extra information. Team-size tables and core proposal/vote/mission mechanics are identical in both games.

---

## 2. Complete core rules

### 2.1 Setup

1. Choose the score tableau matching the player count (the game ships with 3 double-sided tableaus covering 5–10 players).
2. Shuffle the appropriate mix of Good and Evil character cards (see §3.1/§3.4) and deal one face-down to each player. Players secretly look at their own card.
3. Each player gets 2 vote tokens (1 Approve, 1 Reject).
4. Randomly select the first Leader; the Leader takes the Leader token. Leadership passes clockwise after every vote.
5. Run the "night phase" reveal script (§2.2).

### 2.2 Night phase (eyes-closed reveal script)

Official script with Merlin + Assassin (and optionally Percival/Morgana/Mordred/Oberon). Lines in *italics* only apply when the relevant optional roles are in play:

1. "Everyone close your eyes and extend your hand into a fist in front of you."
2. "Minions of Mordred — *not Oberon* — open your eyes and look around so that you know all agents of Evil."
3. "Minions of Mordred close your eyes."
4. "All players should have their eyes closed."
5. "Minions of Mordred — *not Mordred himself* — extend your thumb so that Merlin will know of you."
6. "Merlin, open your eyes and see the agents of Evil."
7. "Minions of Mordred — put your thumbs down and re-form your hand into a fist."
8. "Merlin, close your eyes."
9. *"Merlin and Morgana — extend your thumb so that Percival may know of you."*
10. *"Percival, open your eyes so you may know Merlin and Morgana."* (Percival cannot tell which is which.)
11. *"Merlin and Morgana — put your thumbs down. Percival, close your eyes."*
12. "All players should have their eyes closed."
13. "Everyone open your eyes."

For a digital implementation this becomes: each player privately receives exactly the information their role grants (see knowledge matrix, §3.3).

### 2.3 Round structure

Each of the (up to) 5 rounds/Quests has two phases; a round may loop through several proposals.

**Team Building phase**
1. The Leader, after open table discussion, proposes a team of exactly the required size (§3.2) by assigning Team tokens. The Leader may include themself. Any player may be proposed regardless of previous quest participation.
2. All players (including the Leader) simultaneously and secretly select a vote token, then all reveal at once.
3. **Strict majority of Approve** → team is approved, go to Quest phase. **Tie or majority Reject** → proposal fails; the Leader token passes clockwise, the vote track marker advances, and a new proposal is made.
4. **Five-rejection rule: if 5 consecutive proposals are rejected within a single round, Evil immediately wins the game.** (The vote track on the board has 5 spaces to track this; it resets when a team is approved.)

**Quest phase**
1. Each team member secretly receives a set of Quest cards (1 Success + 1 Fail) and plays one face-down. **Good players must play Success; Evil players may play either.**
2. The Leader collects, shuffles, and reveals the played cards (shuffling hides who played what).
3. The Quest **succeeds only if every card is a Success**. A single Fail card fails the Quest — **except Quest 4 in games of 7+ players, which requires at least 2 Fail cards to fail** (marked on the tableau).
4. Place a blue (success) or red (fail) score marker on the Quest's circle, advance the round marker, pass leadership clockwise, and begin the next round.

### 2.4 Game end and assassination

- **Evil wins immediately** when 3 Quests have failed, or when 5 team proposals are rejected in one round.
- When **3 Quests succeed**, the game does *not* immediately end: the **Assassination phase** begins. Evil players reveal themselves (optionally) and discuss openly; then the player holding the **Assassin** card names one Good player as Merlin. If the named player is Merlin, **Evil wins**; otherwise **Good wins**.
- Practical implication: Merlin must steer Good to victory while staying anonymous; Good's real win condition is "3 successes AND Merlin survives the assassination."

---

## 3. Rules reference tables (transcribe into game config)

### 3.1 Good/Evil counts per player count

| Players | Good | Evil |
|--------:|-----:|-----:|
| 5  | 3 | 2 |
| 6  | 4 | 2 |
| 7  | 4 | 3 |
| 8  | 5 | 3 |
| 9  | 6 | 3 |
| 10 | 6 | 4 |

### 3.2 Quest team sizes per player count

Asterisk (*) = quest requires **2 Fail cards** to fail (only Quest 4, only at 7+ players). All other quests fail on 1 Fail card.

| Quest | 5p | 6p | 7p | 8p | 9p | 10p |
|------:|---:|---:|---:|---:|---:|----:|
| 1 | 2 | 2 | 2 | 3 | 3 | 3 |
| 2 | 3 | 3 | 3 | 4 | 4 | 4 |
| 3 | 2 | 4 | 3 | 4 | 4 | 4 |
| 4 | 3 | 3 | 4* | 5* | 5* | 5* |
| 5 | 3 | 4 | 4 | 5 | 5 | 5 |

As config data:

```
teamSizes = {
  5:  [2, 3, 2, 3, 3],
  6:  [2, 3, 4, 3, 4],
  7:  [2, 3, 3, 4, 4],
  8:  [3, 4, 4, 5, 5],
  9:  [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
}
evilCount = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 }
doubleFailQuest = playerCount >= 7 ? 4 : none   // quest index 4 (1-based)
maxRejectedProposalsPerRound = 5                // 5th rejection => evil wins
voteApproval = strictMajority                   // tie = reject
```

### 3.3 Role knowledge matrix

| Role | Team | Knows / sees | Seen by |
|------|------|--------------|---------|
| **Merlin** | Good | All Evil players **except Mordred** (sees Assassin, Morgana, Oberon, generic Minions) | Percival (ambiguously, if Percival in play) |
| **Percival** | Good | Merlin and Morgana as an unordered pair ("one of these two is Merlin") | — |
| **Loyal Servant of Arthur** | Good | Nothing | — |
| **Assassin** | Evil | Fellow Evil (except Oberon) | Merlin |
| **Morgana** | Evil | Fellow Evil (except Oberon) | Merlin; Percival (as possible-Merlin) |
| **Mordred** | Evil | Fellow Evil (except Oberon) | **Not seen by Merlin** |
| **Oberon** | Evil | **Nothing** — does not see other Evil | Merlin sees him; **other Evil do not** |
| **Minion of Mordred** | Evil | Fellow Evil (except Oberon) | Merlin |

Power summary (rulebook wording): Percival "knows Merlin"; Mordred "is not revealed to Merlin"; Morgana "appears to be Merlin, revealing herself to Percival as Merlin"; Oberon "does not reveal himself to the other Evil players, nor does he gain knowledge of the other Evil players."

Balance direction: Percival, Oberon, Lady of the Lake strengthen **Good**; Mordred, Morgana strengthen **Evil**.

### 3.4 Role setup per player count

Official rulebook rules of composition:
- Merlin and Assassin are the recommended baseline pair (always add both together — Assassin is meaningless without Merlin and vice versa).
- Every optional Good character **replaces** a Loyal Servant; every optional Evil character **replaces** a Minion. Total Good/Evil counts (§3.1) never change.
- Rulebook balance warning: "For games of 5, be sure to add either Mordred or Morgana when playing with Percival" (Percival alone makes Good too strong at low counts).
- The box contains 14 character cards: Merlin, Assassin, Percival, Morgana, Mordred, Oberon, 5 Loyal Servants, 3 Minions. (Note: 10-player Evil needs 4 — one special Evil is required at 10 players since there are only 3 Minion cards.)

Common community/digital default setups (not official, but the de-facto standard on ProAvalon and similar sites — a good default for the app):

| Players | Good roles | Evil roles |
|--------:|-----------|-----------|
| 5  | Merlin, Percival, 1 Servant | Morgana, Assassin |
| 6  | Merlin, Percival, 2 Servants | Morgana, Assassin |
| 7  | Merlin, Percival, 2 Servants | Morgana, Assassin, Oberon (or Minion) |
| 8  | Merlin, Percival, 3 Servants | Morgana, Assassin, 1 Minion |
| 9  | Merlin, Percival, 4 Servants | Morgana, Assassin, Mordred |
| 10 | Merlin, Percival, 4 Servants | Morgana, Assassin, Mordred, Oberon |

Simplest beginner setup at any count: Merlin + Assassin + fill with Servants/Minions.

---

## 4. Optional rules & variants (brief)

- **Lady of the Lake** (in the base box): token starts with the player to the first Leader's **right**. Immediately after Quests 2, 3, and 4 resolve, the holder examines one other player's loyalty: the examined player secretly shows the Good or Evil **loyalty card** matching their true allegiance (lying = automatic loss), then receives the token. A player who has used the Lady cannot be examined with it. Used exactly 3 times per game. Strengthens Good; rulebook recommends it for 7+ players. The examination result is private — the holder may lie about what they saw.
- **Targeting variant**: Quests need not be attempted in order 1→5; the Leader picks which incomplete Quest the proposed team will attempt (Quest 5 only after two Quests have succeeded; the 2-fail rule stays attached to Quest 4 at 7+).
- **Excalibur** (Big Box / expansion module, analogous to "the Sergeant" in The Resistance): during Team Building, the Leader gives one team member the Excalibur card along with their Team token. After Quest cards are played but before the reveal, the Excalibur holder may force one *other* team member to switch their played card (publicly known that a switch happened). Adds mid-quest counterplay.
- **Plot cards** (from parent game *The Resistance*): action cards dealt by the Leader that reveal loyalties, force card plays face-up, etc. Rarely used with Avalon roles; if used with Merlin, reveals are done with loyalty cards rather than character cards.
- **Big Box roles** (later official expansions, for future reference): Lancelots (allegiance-switching), Lady of Sea, Cleric, Troublemaker, Untrustworthy Servant, Lunatic (must fail every quest), Brute, Revealer, Trickster, Sorcerer. avalon.fun's wiki also lists community roles like Tristan/Isolde, Guinevere, Witch. Not needed for v1.
- **Common digital house rule to be aware of**: some implementations soften the five-rejection rule into a "hammer" — the 5th proposal is auto-approved or vote-less (avalon-game.com describes "the fifth Leader has the power to choose the quest team without a vote"). ProAvalon keeps the official rule and calls the 5th leader "the hammer" (rejecting the hammer = Evil wins). **Official rule: 5 rejections in a round = Evil wins.** Recommend implementing the official rule, with the term "hammer" surfaced in UI.

---

## 5. Visual design language — the physical game

### 5.1 Component inventory

14 character cards, 10 quest cards (5 Success, 5 Fail), 5 Team tokens, 20 vote tokens (10 Approve, 10 Reject), 5 score markers, 1 round marker, 1 vote track marker, 1 Leader token, 3 double-sided score tableaus, 2 loyalty cards (Good/Evil, for Lady of the Lake), 1 Lady of the Lake token.

### 5.2 Art & color language

- **Core color code: blue = Good/Arthur, red = Evil/Mordred.** This runs through every component and is the single most important visual convention to preserve.
- **Character cards**: painterly medieval-fantasy portrait art. Good characters carry **Arthur's sigil on a blue background**; Evil characters carry **Mordred's sigil on a red background**. Card backs are uniform so hands are indistinguishable.
- **Quest cards**: Success card in blue tones, Fail card in red/dark tones; identical backs (they must be shuffled and revealed anonymously).
- **Vote tokens**: round tokens — Approve (blue, Arthur imagery) and Reject (red).
- **Score markers**: round tokens — blue marker bearing Arthur's sigil for a success, red marker with Mordred's sigil for a failure, placed on the tableau's quest circles.
- **Score tableau**: parchment/aged-paper board, medieval illustration, with **5 large quest circles** in a row (each printed with that quest's required team size; the 2-fail quest is specially marked), plus a **5-space vote track** along the bottom for the vote track marker (rejection counter).
- **Leader token and Team tokens**: shield/banner-shaped markers passed around the table.
- Overall aesthetic: Arthurian legend — castles, stone, torchlight, banners, illuminated-manuscript flourishes; serif/blackletter-adjacent display type on the box.

---

## 6. Digital adaptation UI patterns

Sources: ProAvalon (proavalon.com, open source at github.com/vck3000/ProAvalon), avalon.fun / avalon-game.com. Note avalon.fun and avalon-game.com are the same project.

### 6.1 Table layout

- **Players arranged in a circle/ring of avatar cards** around a central board area, mimicking sitting at a table. Seat order matters (leadership passes clockwise) so the ring must communicate turn order.
- **Center of the ring: the 5 quest circles** (mission boxes), color-filled blue/red as quests resolve, each labeled with team size and the 2-fail marker where applicable, plus the rejection/vote track (1–5).
- **Leader indicator**: a crown or star icon on the current leader's avatar; ProAvalon also shows a "hammer" indicator marking which seat will be the 5th proposer.
- Avatar decorations carry game state: team-membership token on proposed players, vote token revealed next to each avatar, Lady of the Lake token holder marked.
- ProAvalon: game room is **resizable** (drag a divider or set a value); avatar positions are tuned per player count; hovering a mission box in history highlights the players who were on that team.

### 6.2 Hidden information presentation

- Each player has a **private role panel**: role name, team, and the exact knowledge their role grants ("You are Merlin. These players are Evil: …"), typically also marking known players directly on their avatars (e.g., red glow on evil players as seen by Merlin, "Merlin?" badge on Percival's two candidates).
- Role info is shown only to that client; the same table renders differently per viewer. This per-viewer projection of state is the core architectural requirement.
- Spectators see nothing hidden until game end (ProAvalon reveals all roles at game end and in saved game records).

### 6.3 Dramatizing votes and quest reveals

- **Team proposal**: leader clicks avatars to select; selected players get a visible team token; a "picking" animation plays (ProAvalon animates the team tokens/guns moving).
- **Voting**: all players vote simultaneously and privately (Approve/Reject buttons); UI shows who has/hasn't voted yet (without revealing the vote), then **all vote tokens flip at once** next to each avatar — public, permanent record. ProAvalon keeps a **Vote History tab**: a grid of every proposal (leader, team, each player's vote, outcome) — essential deduction material and worth first-class UI.
- **Quest resolution**: team members privately click Success/Fail; then cards are revealed **shuffled, one at a time** (flip animation, often with suspenseful delay between cards) so nobody can attribute a Fail to a player. Result fills the mission circle blue/red.
- **Assassination**: distinct dramatic phase — Assassin selects an avatar, confirmation, then full role reveal of the whole table with win/lose banner.
- **Sound cues** for phase changes (your turn to vote, quest result, game start), with volume control.
- **Timers**: optional per-phase clocks (proposal timer, vote timer) with a pause vote — important for keeping games moving; for an LLM-bot game, timers pace the bots' "thinking".

### 6.4 Discussion & deduction support

- Persistent **chat pane** (avalon.fun places chat below the table; ProAvalon has chat and vote-history as two tabs) with message quoting.
- **Claiming system** (ProAvalon): structured way for a player to publicly claim a role.
- **Player notes**: scratchpad for suspicions.
- Game-end **role reveal + replay/history** of all proposals and votes.

---

## 7. Accessibility / UX conventions worth copying

From ProAvalon's changelog plus general practice:

1. **Never rely on blue/red alone** — pair color with iconography (Arthur sigil vs. Mordred sigil, shield vs. sword, check vs. X). ProAvalon ships alternative colorblind icon sets.
2. **Dark theme toggle** site-wide.
3. **Adjustable font size** and dynamic font scaling for small screens.
4. **Responsive/mobile layout**: the ring-of-avatars layout must reflow; ProAvalon warns against landscape on phones and enlarges touch targets.
5. **Explicit turn/phase prompts**: always show whose action is awaited and what phase the game is in ("Waiting for 2 players to vote"); sound notification when it's your turn.
6. **Public information must be inspectable, not ephemeral**: vote history grid, mission team history, rejection counter — deduction games die when players can't review the record.
7. **Simultaneity guarantees**: show "voted/not voted" status but reveal all at once; shuffle quest cards before reveal; never let timing side-channels leak who played Fail (in a bot game, add randomized reveal delays so bot response time leaks nothing).
8. **Confirmation on irreversible actions** (final team submit, vote, quest card, assassination target).
9. **Tooltips/reference in-UI**: role reference and the team-size table available at all times; abbreviation glossary toggle (ProAvalon).
10. **Private info styling**: make privileged knowledge visually distinct (e.g., a bordered "only you can see this" panel) so players never confuse private intel with public state.

---

## 8. Sources

- avalon-game.com / avalon.fun rules & expansion wiki: https://avalon-game.com/wiki/rules/ , https://avalon-game.com/wiki/expansions/lady/ , https://avalon-game.com/wiki/roles/
- UltraBoardGames Avalon rules & optional rules: https://www.ultraboardgames.com/avalon/game-rules.php , https://www.ultraboardgames.com/avalon/optional-rules.php
- RulesPal official rulebook transcription: https://www.rulespal.com/resistance-avalon/rulebook
- Dized rules (Lady of the Lake, quest selection): https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg
- ProAvalon (open-source platform + changelog): https://github.com/vck3000/ProAvalon , https://www.proavalon.com/changelog
- Avalon Big Box (Excalibur module): https://indieboardsandcards.com/our-games/avalon-big-box/
- The Resistance (parent game): https://en.wikipedia.org/wiki/The_Resistance_(game)
