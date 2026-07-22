// Headless simulation CLI.
//   node server/sim/sim.ts --players 7 --seed 42            # one game, transcript
//   node server/sim/sim.ts --players 7 --games 200          # aggregate stats
//   node server/sim/sim.ts --agents random --talk 0,0
import { parseArgs } from 'node:util'
import { createGame } from '../engine/game.ts'
import { createAgent } from '../agents/registry.ts'
import { runGame } from './runner.ts'
import { renderEvent, revealRoles } from './render.ts'
import type { AgentSpec, AvalonAgent } from '../agents/types.ts'
import type { Seat } from '../engine/types.ts'

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '7' },
    seed: { type: 'string', default: 'sim' },
    games: { type: 'string', default: '1' },
    agents: { type: 'string', default: 'heuristic' }, // heuristic | random | mixed
    talk: { type: 'string', default: '1,0' },         // pre,post rounds
    quiet: { type: 'boolean', default: false },
  },
})

const playerCount = Number(values.players)
const games = Number(values.games)
const [pre, post] = values.talk!.split(',').map(Number)

function specFor(seat: Seat): AgentSpec {
  if (values.agents === 'random') return { type: 'random' }
  if (values.agents === 'mixed') return seat % 2 === 0 ? { type: 'heuristic' } : { type: 'random' }
  return { type: 'heuristic' }
}

const tally = { good: 0, evil: 0, reasons: new Map<string, number>(), degraded: 0 }

for (let i = 0; i < games; i++) {
  const seed = games === 1 ? values.seed! : `${values.seed}-${i}`
  const game = createGame({ seed, playerCount, talk: { preProposal: pre, postProposal: post } })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((p) => [p.seat, createAgent(specFor(p.seat), { seed, seat: p.seat })]),
  )
  const verbose = games === 1 && !values.quiet
  const result = await runGame({
    game, agents,
    onEvent: verbose ? (ev) => { const line = renderEvent(ev, game); if (line) console.log(line) } : undefined,
  })
  tally[result.game.winner!]++
  tally.reasons.set(result.game.winReason!, (tally.reasons.get(result.game.winReason!) ?? 0) + 1)
  tally.degraded += result.degraded.length
  if (verbose) {
    console.log('\n' + revealRoles(game))
    console.log(`\nWinner: ${game.winner} (${game.winReason})  [seed ${seed}]`)
    if (result.degraded.length) console.log(`degraded decisions: ${result.degraded.length}`)
  }
}

if (games > 1) {
  console.log(`\n${games} games, ${playerCount} players, agents=${values.agents}, talk=${values.talk}`)
  console.log(`good wins: ${tally.good} (${((tally.good / games) * 100).toFixed(1)}%)`)
  console.log(`evil wins: ${tally.evil} (${((tally.evil / games) * 100).toFixed(1)}%)`)
  for (const [reason, n] of [...tally.reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${n}`)
  }
  if (tally.degraded) console.log(`degraded decisions total: ${tally.degraded}`)
}
