// Uniform-legal-random agent. Exists for fuzzing: if random play can crash or
// stall the engine, the engine is wrong.

import { makeRng, fnv1a } from '../engine/prng.ts'
import { teamsEqual } from '../engine/rules.ts'
import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import type { AgentContext, AvalonAgent } from './types.ts'

export function randomDecide(req: DecisionRequest, view: PlayerView, seed: string): Decision {
  const rng = makeRng(fnv1a(`rnd:${seed}:${req.seat}:${view.events.length}:${req.kind}`))
  const seats = view.players.map((p) => p.seat)
  switch (req.kind) {
    case 'discuss': {
      // Random leans exercise the settlement/lean-change tracking in fuzz.
      const lean = rng.chance(0.6)
        ? rng.pick(['approve', 'reject', 'unsure'] as const)
        : undefined
      return { kind: 'discuss', say: rng.chance(0.5) ? '' : 'Hmm.', lean }
    }
    case 'propose': {
      const size = view.quests[view.round - 1].teamSize
      return { kind: 'propose', team: rng.shuffle(seats).slice(0, size) }
    }
    case 'finalize': {
      // Revise sometimes so fuzz exercises the post-revision segment; the
      // engine rejects an identical "revision", so fall back to stick.
      if (rng.chance(0.8)) return { kind: 'finalize', stick: true }
      const size = view.quests[view.round - 1].teamSize
      const team = rng.shuffle(seats).slice(0, size).sort((a, b) => a - b)
      if (teamsEqual(team, view.currentTeam ?? [])) return { kind: 'finalize', stick: true }
      return { kind: 'finalize', stick: false, team }
    }
    case 'vote':
      return { kind: 'vote', vote: rng.chance(0.5) ? 'approve' : 'reject' }
    case 'quest':
      return { kind: 'quest', card: rng.chance(0.5) ? 'success' : 'fail' }
    case 'assassinate':
      return { kind: 'assassinate', target: rng.pick(seats.filter((s) => s !== req.seat)) }
  }
}

export function createRandomAgent(ctx: AgentContext): AvalonAgent {
  return {
    decide: async (req, view) => randomDecide(req, view, ctx.seed),
  }
}
