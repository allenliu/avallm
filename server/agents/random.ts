// Uniform-legal-random agent. Exists for fuzzing: if random play can crash or
// stall the engine, the engine is wrong.

import { makeRng, fnv1a } from '../engine/prng.ts'
import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import type { AgentContext, AvalonAgent } from './types.ts'

export function randomDecide(req: DecisionRequest, view: PlayerView, seed: string): Decision {
  const rng = makeRng(fnv1a(`rnd:${seed}:${req.seat}:${view.events.length}:${req.kind}`))
  const seats = view.players.map((p) => p.seat)
  switch (req.kind) {
    case 'discuss':
      return { kind: 'discuss', say: rng.chance(0.5) ? '' : 'Hmm.' }
    case 'propose': {
      const size = view.quests[view.round - 1].teamSize
      return { kind: 'propose', team: rng.shuffle(seats).slice(0, size) }
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
