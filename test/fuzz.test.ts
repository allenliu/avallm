// Fuzz: full games at every player count with heuristic and random agents.
// If random-legal play can crash or stall the engine, the engine is wrong.
// Also pins replay determinism: same seed + same agents => identical logs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { createAgent } from '../server/agents/registry.ts'
import { runGame } from '../server/sim/runner.ts'
import type { AgentSpec, AvalonAgent } from '../server/agents/types.ts'
import type { Game, Seat } from '../server/engine/types.ts'

async function play(
  playerCount: number, seed: string, spec: AgentSpec,
  talk: { maxRounds: number; maxRoundsAfterChange: number },
): Promise<{ game: Game; degradedCount: number }> {
  const game = createGame({ seed, playerCount, talk })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((p) => [p.seat, createAgent(spec, { seed, seat: p.seat })]),
  )
  const result = await runGame({ game, agents })
  return { game: result.game, degradedCount: result.degraded.length }
}

function checkInvariants(game: Game, ctx: string): void {
  assert.equal(game.phase, 'gameOver', ctx)
  assert.ok(game.winner === 'good' || game.winner === 'evil', ctx)
  const resolved = game.quests.filter((q) => q.result !== undefined)
  const successes = resolved.filter((q) => q.result === 'success').length
  const fails = resolved.filter((q) => q.result === 'fail').length
  assert.ok(successes <= 3 && fails <= 3, ctx)
  if (game.winReason === 'threeFails') assert.equal(fails, 3, ctx)
  if (game.winReason === 'threeQuests' || game.winReason === 'assassinMissed'
    || game.winReason === 'merlinAssassinated') {
    assert.equal(successes, 3, ctx)
  }
  for (const q of resolved) {
    assert.ok(q.team && q.team.length === q.teamSize, ctx)
    assert.ok(q.failCount! >= 0 && q.failCount! <= q.teamSize, ctx)
    assert.equal(q.result, q.failCount! >= q.failsRequired ? 'fail' : 'success', ctx)
  }
}

test('heuristic games terminate cleanly at every player count', async () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    for (let s = 0; s < 15; s++) {
      const ctx = `heuristic ${playerCount}p seed=${s}`
      const talk = s % 3 === 0 ? { maxRounds: 2, maxRoundsAfterChange: 1 } : { maxRounds: 0, maxRoundsAfterChange: 0 }
      const { game, degradedCount } = await play(playerCount, `fz-${playerCount}-${s}`, { type: 'heuristic' }, talk)
      checkInvariants(game, ctx)
      assert.equal(degradedCount, 0, `${ctx}: heuristic decisions must always be legal`)
    }
  }
})

test('random-legal games terminate cleanly', async () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    for (let s = 0; s < 8; s++) {
      const ctx = `random ${playerCount}p seed=${s}`
      // maxRounds 3,2 so random leans exercise settlement tracking and the
      // random agent's 20% revise exercises the post-revision segment.
      const { game, degradedCount } = await play(
        playerCount, `fzr-${playerCount}-${s}`, { type: 'random' }, { maxRounds: 3, maxRoundsAfterChange: 2 },
      )
      checkInvariants(game, ctx)
      assert.equal(degradedCount, 0, `${ctx}: random agent must always be legal`)
    }
  }
})

test('both sides can win under heuristic play', async () => {
  const winners = new Set<string>()
  for (let s = 0; s < 40 && winners.size < 2; s++) {
    const { game } = await play(7, `win-${s}`, { type: 'heuristic' }, { maxRounds: 0, maxRoundsAfterChange: 0 })
    winners.add(game.winner!)
  }
  assert.ok(winners.has('good'), 'good never won in 40 games — heuristics degenerate')
  assert.ok(winners.has('evil'), 'evil never won in 40 games — heuristics degenerate')
})

test('replay determinism: same seed and agents produce identical event logs', async () => {
  for (const [playerCount, seed] of [[5, 'det-a'], [7, 'det-b'], [10, 'det-c']] as const) {
    const a = await play(playerCount, seed, { type: 'heuristic' }, { maxRounds: 2, maxRoundsAfterChange: 1 })
    const b = await play(playerCount, seed, { type: 'heuristic' }, { maxRounds: 2, maxRoundsAfterChange: 1 })
    assert.equal(JSON.stringify(a.game.log), JSON.stringify(b.game.log), `${playerCount}p ${seed}`)
  }
})
