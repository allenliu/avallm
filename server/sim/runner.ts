// Headless driver: pumps expectedDecisions through agents until gameOver.
// Simultaneous kinds (vote, quest) fan out in parallel — matches the rules
// and collapses the worst latency moments once agents are LLMs.
// Any agent failure or illegal decision degrades to the heuristic, loudly
// recorded — the game never stalls on a bad agent.

import { applyDecision, expectedDecisions } from '../engine/game.ts'
import { viewFor } from '../engine/view.ts'
import { heuristicDecide } from '../agents/heuristic.ts'
import type { AvalonAgent } from '../agents/types.ts'
import type { Decision, DecisionRequest, Game, GameEvent, Seat } from '../engine/types.ts'

export interface DegradedDecision {
  seat: Seat
  kind: DecisionRequest['kind']
  atEvent: number
  error: string
}

export interface RunResult {
  game: Game
  degraded: DegradedDecision[]
  steps: number
}

export interface RunOpts {
  game: Game
  agents: Map<Seat, AvalonAgent>
  onEvent?: (ev: GameEvent) => void | Promise<void>
  maxSteps?: number
}

export async function runGame(opts: RunOpts): Promise<RunResult> {
  const { game, agents } = opts
  const maxSteps = opts.maxSteps ?? 5000
  const degraded: DegradedDecision[] = []
  let steps = 0
  let emitted = 0

  const flushEvents = async () => {
    if (!opts.onEvent) return
    while (emitted < game.log.length) {
      await opts.onEvent(game.log[emitted++])
    }
  }
  await flushEvents()

  const decideOne = async (req: DecisionRequest): Promise<{ req: DecisionRequest; decision: Decision }> => {
    const view = viewFor(game, req.seat)
    const agent = agents.get(req.seat)
    if (!agent) throw new Error(`no agent for seat ${req.seat}`)
    try {
      const decision = await agent.decide(req, view)
      return { req, decision }
    } catch (err) {
      degraded.push({
        seat: req.seat, kind: req.kind, atEvent: game.log.length,
        error: err instanceof Error ? err.message : String(err),
      })
      return { req, decision: heuristicDecide(req, view, game.seed) }
    }
  }

  while (game.phase !== 'gameOver') {
    if (++steps > maxSteps) {
      throw new Error(`game exceeded ${maxSteps} decision steps — engine stuck?`)
    }
    const reqs = expectedDecisions(game)
    if (reqs.length === 0) throw new Error(`no expected decisions in phase ${game.phase}`)

    // All current requests are independent (same phase), so resolve together.
    const results = reqs.length === 1
      ? [await decideOne(reqs[0])]
      : await Promise.all(reqs.map(decideOne))

    for (const { req, decision } of results) {
      try {
        applyDecision(game, req.seat, decision)
      } catch (err) {
        // Illegal decision (bad team, bad target...): substitute the heuristic.
        degraded.push({
          seat: req.seat, kind: req.kind, atEvent: game.log.length,
          error: err instanceof Error ? err.message : String(err),
        })
        applyDecision(game, req.seat, heuristicDecide(req, viewFor(game, req.seat), game.seed))
      }
      await flushEvents()
    }
  }

  for (const agent of agents.values()) agent.dispose?.()
  return { game, degraded, steps }
}
