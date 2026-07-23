# AvaLLM

**Avalon vs. the LLMs.** A web-based implementation of **The Resistance: Avalon** where the other players — allies and opponents alike — are bots powered by LLMs.

## The hook

Every bot at the table is openly labeled with the model that drives it. You're not bluffing "Player 3" — you're trying to slip a fail card past **Gemini**, or convince **DeepSeek** that you're not Merlin. Knowing *whose* reasoning style you're up against is part of the game.

## Status

Milestone 2: playable in the browser against real LLM bots. Server is zero-dependency Node ≥ 24 (native TypeScript); the client is React + Vite.

```
# one-time client build
npm --prefix client install && npm --prefix client run build

# put an OpenRouter key in .env (gitignored):
#   OPENROUTER_API_KEY=sk-or-...
#   OPENROUTER_MAX_SPEND_USD=2        # spend ceiling (best-effort), recommended

node server/server.ts                      # then open http://localhost:8787
```

The launcher offers LLM opponents (a few cents per game, ~$0.12 measured at 5 players) or free rule-based bots, seated from a browsable agent library (including agents you define yourself). Post-game, the reveal screen shows every bot's secret quest cards and private reasoning.

**Multiplayer**: set "Humans" above 1 to create a lobby and get an invite link — the game auto-starts when the last human seat fills, bots take the remaining chairs, and latecomers can spectate (public information only). No turn timers; play it like mail chess. Works over LAN by sharing your machine's address.

Headless tools:

```
npm test                                   # full suite, no API needed
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
- `docs/design-evaluation.md` — bot evaluation & self-improvement framework (paired-seed benches, LLM judge, situation bank)

## Deploying (Railway)

The repo carries a `Dockerfile` + `railway.toml` (Dockerfile builder — required, because the
server runs TypeScript natively on Node 24, which nixpacks won't provide). To deploy:

1. Railway → New Project → Deploy from GitHub repo → pick this repo, and set the tracked branch
   to **`deploy`** (Settings → Source). The Dockerfile is detected automatically. Tracking
   `deploy` instead of `master` decouples pushing from deploying: `git push origin master`
   publishes code without touching the deployment, and a deploy is an explicit
   `git push origin <sha>:deploy` (or `origin/master:deploy` to deploy the latest push;
   `--force-with-lease` with an older sha to roll back). `origin/deploy` always names the
   deployed commit.
2. Set variables: `OPENROUTER_API_KEY` (required for LLM bots), `OPENROUTER_MAX_SPEND_USD`
   (recommended hard spend ceiling, e.g. `5`), and `AVALON_INVITE_CODE` (**strongly recommended
   on any public URL** — without it, anyone who finds the site can start LLM games on your key).
   Railway injects `PORT` automatically; the server honors it.
3. Generate a domain (Settings → Networking). Done — lobbies, SSE streams, and invite links all
   work over a single HTTP port.

The invite code gates creating lobbies/games/custom agents; joining an existing game by invite
URL is deliberately ungated. Caveats: games live in memory (a redeploy or restart ends running
games — snapshot persistence is on the roadmap), and custom agents persist to the container
filesystem (ephemeral on Railway unless you attach a volume at `/app/data`).

## Research & prior art

Bot design draws on the published literature for LLMs playing Avalon and related social-deduction
games — distilled into an embeddable playbook in [`docs/research-strategy.md`](docs/research-strategy.md)
§4–5, which feeds the default prompts and the evaluation framework
([`docs/design-evaluation.md`](docs/design-evaluation.md)). Recurring findings we build against:
LLMs are weak at deduction in free text and worse at *acting* on their own deductions
(the "deduction–action gap"), they self-incriminate and over-disclose, and out-of-the-box they
still lose to simple rule-based baselines — so the engineering leans on computing signals in code
and feeding them as structured facts, hard guards on provably-losing moves, and a second-order
"what does this reveal about me?" check before speech.

Key sources:

- **AvalonBench** — Light et al., *Evaluating LLMs Playing the Game of Avalon* (2023): the baseline
  benchmark and failure taxonomy. [paper](https://arxiv.org/abs/2310.05036) ·
  [Avalon-LLM + the Strategist agent](https://github.com/jonathanmli/Avalon-LLM) (MCTS + LLM
  self-improvement) — the intended external calibration opponents (a difficulty floor and a boss
  ceiling) via the planned stdio bridge.
- **ReCon** — Wang et al., *Recursive Contemplation* (2023): two-pass draft→refine with first/second-
  order perspective-taking to resist deception. [paper](https://arxiv.org/abs/2310.01320)
- **LLM Agent Society** — *Language Agents with Reinforcement Learning for Strategic Play in the
  Werewolf/Avalon setting* (arXiv 2310.14985): a modular agent whose role-inference and
  strategy-memory modules mattered most in ablation.
- **DeepRole** (MIT/Harvard, CFR + deductive belief updating) and the **Assassin classifier**
  (Chuchro, 2022) — non-LLM agents showing Merlin-detection is largely a mechanical vote-signal task.
- Recent extensions: *Beyond Survival: Evaluating LLMs in Social Deduction Games with Human-Aligned
  Strategies* ([arXiv 2510.11389](https://arxiv.org/abs/2510.11389)) and *Trust, Lies, and Long
  Memories* ([arXiv 2604.20582](https://arxiv.org/abs/2604.20582)) on multi-round reputation and
  cross-game memory.

LLM integration patterns (OpenRouter client, prompt structure) draw on the sibling `datingsim` project.
