# AvaLLM

**Play The Resistance: Avalon against a table of LLM bots, where every bot wears the name of the model running it.** Some of them are your loyal servants, some are hidden minions, and it is on you to tell which is which. AvaLLM is a full web implementation of the game: an authoritative Node server, a React client, and a headless simulator so you can build and test without spending on API calls.

## The hook

The other players are not anonymous "Player 3" slots. Each seat is openly labeled with the model behind it, so you are trying to slip a fail card past Gemini, or convince DeepSeek that you are not Merlin. Knowing whose reasoning style you are up against, and how a given model tends to bluff, deduce, and crack under questioning, becomes part of the game.

## What a game looks like

You sit down at an Avalon table of 5 to 10 seats. You take one; bots fill the rest. Before the deal you choose who those bots are:

- **LLM bots**, a few cents per game on OpenRouter, or **free rule-based bots** that play from hand-written heuristics and never touch the network.
- Both come from a browsable **agent library**. It ships curated character cards (Sherlock Holmes, Sun Tzu, Socrates, Gandalf, Gollum, Bob Ross), and you can define your own. A custom agent can carry author-written strategy, not just flavor, while the engine keeps what it can see and how its output is read locked down (see [`docs/design-custom-agents.md`](docs/design-custom-agents.md)).

The bots do not just vote in silence. Each round the leader proposes a team, the whole table discusses it in a live chat feed, the leader can revise, and only then does everyone vote. You read the leans and the table talk before casting your own vote, the same way you would at a real table.

Want to play with people? Set the human count above one to open a lobby and get an invite link. The game auto-starts when the last human seat fills, bots take the remaining chairs, and anyone who arrives late can spectate with public information only. There are no turn timers, so a game can unfold over days like correspondence chess. It also works over a LAN by sharing your machine's address.

When the game ends, the reveal screen opens every bot's hidden hand: the secret quest cards they played and the private reasoning behind each move.

## Run it locally

The server needs Node 24 or newer and runs TypeScript with no build step. Only the client is built.

```
# one-time client build
npm --prefix client install && npm --prefix client run build

# put an OpenRouter key in .env (gitignored):
#   OPENROUTER_API_KEY=sk-or-...
#   OPENROUTER_MAX_SPEND_USD=2        # best-effort spend ceiling, recommended

node server/server.ts                  # then open http://localhost:8787
```

No key? Everything except the LLM bots still works, and the headless tools below run entirely offline.

## Play and test headless

The engine is pure and deterministic, so a whole game can run without a browser or an API key. This is the fast path for development, and for measuring how the bots actually do.

```
npm test                                # full test suite, no API needed
npm run sim -- --players 7 --seed 42    # one heuristic game, full transcript
npm run sim -- --games 200 --talk 0,0   # aggregate win-rate stats
npm run sim -- --agents llm --players 5 # a real LLM game headless, with a cost breakdown
npm run play                            # play from the terminal against heuristic bots
```

## How it's built

AvaLLM is an authoritative server plus a thin client, with one rule running through the middle: hidden information never reaches the browser. The server owns the full game state, the role deal, and every bot prompt; the client only ever sees the current human's filtered view of the game.

The code is layered so the game logic never knows or cares what kind of player is answering:

- **`server/engine/`** is pure, deterministic game logic. It is event-sourced (the game log is the record, and each seat's view is derived from it), uses a seeded PRNG, and does no I/O. A single function, `viewFor`, is the one place hidden information gets filtered per seat.
- **`server/agents/`** is the pluggable player boundary. Every agent answers the same decision request, whether it is an LLM, a heuristic, a random mover, or an external process speaking JSON over stdio. Illegal or malformed output quietly falls back to the heuristic, so a game never stalls.
- **`server/llm/`** is the single chokepoint for OpenRouter: spend accounting and a hard ceiling, reasoning-token suppression tuned per model family, and the model roster.
- **`server/sim/`** holds the headless drivers behind the commands above, and **`server/server.ts`** plus **`client/`** are the web game itself.

Because the engine cannot tell a human from a model, any mix of players is fully simulatable at zero cost.

## How the bots play

Good Avalon bots are harder than they sound, and the published research is blunt about why. Out of the box, LLMs are weak at deduction in free text and even worse at acting on the deductions they do reach (the "deduction-action gap"), they over-disclose and talk themselves into trouble, and they still lose to simple rule-based baselines. AvaLLM is built against those findings: it does the deduction in code and hands the bot structured facts, hard-guards moves that are provably losing, and runs a second-order "what does this reveal about me?" check before a bot speaks.

The prompts are not one generic "play Avalon well" instruction either. Guidance is specialized by role and by decision: how an evil player should time a fail, when Percival should risk revealing, how the assassin should read the vote record to find Merlin. That whole playbook is distilled in [`docs/research-strategy.md`](docs/research-strategy.md), which draws on both strong-human play and the academic literature, and is mapped slot by slot into the prompts.

Key sources:

- **AvalonBench**, Light et al., *Evaluating LLMs Playing the Game of Avalon* (2023): the baseline benchmark and failure taxonomy. [paper](https://arxiv.org/abs/2310.05036), plus [Avalon-LLM and the Strategist agent](https://github.com/jonathanmli/Avalon-LLM), an MCTS-and-LLM opponent that AvaLLM is designed to seat over the stdio bridge as an external difficulty check.
- **ReCon**, Wang et al., *Recursive Contemplation* (2023): a two-pass draft-then-refine loop with first and second-order perspective-taking to resist deception. [paper](https://arxiv.org/abs/2310.01320)
- **LLM Agent Society** (arXiv 2310.14985): a modular agent whose role-inference and strategy-memory modules mattered most in ablation.
- **DeepRole** (CFR plus deductive belief updating) and the **Assassin classifier** (Chuchro, 2022): non-LLM agents showing that spotting Merlin is largely a mechanical vote-signal task.
- Recent extensions: *Beyond Survival* ([arXiv 2510.11389](https://arxiv.org/abs/2510.11389)) and *Trust, Lies, and Long Memories* ([arXiv 2604.20582](https://arxiv.org/abs/2604.20582)), on multi-round reputation and cross-game memory.

## Deploying to Railway

The repo carries a `Dockerfile` and `railway.toml` (the Dockerfile builder is required, because the server runs TypeScript natively on Node 24). Railway tracks a dedicated `deploy` branch rather than `master`, which keeps publishing code separate from shipping it: pushing `master` updates the code without touching the live site, and a deploy is an explicit push to `deploy`.

1. In Railway, create a project from this GitHub repo and set the tracked branch to `deploy` (Settings, Source). The Dockerfile is detected automatically.
2. Set the variables: `OPENROUTER_API_KEY` (required for LLM bots), `OPENROUTER_MAX_SPEND_USD` (a recommended hard spend ceiling, for example `5`), and `AVALON_INVITE_CODE` (strongly recommended on any public URL, since without it anyone who finds the site can start LLM games on your key; comma-separate several codes to hand different groups their own passcode). Railway injects `PORT` and the server honors it.
3. Generate a domain (Settings, Networking). Lobbies, live streams, and invite links all run over the single HTTP port.

The invite code gates creating lobbies, games, and custom agents; joining an existing game by its invite URL is deliberately open. Two things to know: games live in memory, so a redeploy or restart ends any game in progress (snapshot persistence is on the roadmap), and custom agents are written to the container filesystem, which is ephemeral on Railway unless you attach a volume at `/app/data`.

## Docs

The `docs/` folder is the full design record:

- [`research-rules-and-visuals.md`](docs/research-rules-and-visuals.md): Avalon rules reference and visual design research
- [`research-strategy.md`](docs/research-strategy.md): the strategy compendium that feeds the bot prompts
- [`design-implementation.md`](docs/design-implementation.md): architecture and implementation design
- [`design-custom-agents.md`](docs/design-custom-agents.md): how custom and curated agents work, and the safety invariants the engine keeps
- [`design-evaluation.md`](docs/design-evaluation.md): the bot evaluation and self-improvement framework
- [`design-multiplayer.md`](docs/design-multiplayer.md): lobby, spectator, and multiplayer phases
- [`design-snapshots.md`](docs/design-snapshots.md): the session snapshot and restore design (scoped, not yet built)
- [`design-visual.md`](docs/design-visual.md): visual redesign direction and work tracker
- [`ROADMAP.md`](docs/ROADMAP.md): deferred work, in rough priority order
