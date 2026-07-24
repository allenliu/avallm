// The external-agent plugin boundary, end to end: a real child process speaks
// the stdio protocol for one seat; a broken agent degrades to the heuristic
// without stalling the game.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createGame } from '../server/engine/game.ts'
import { createHeuristicAgent } from '../server/agents/heuristic.ts'
import { createStdioAgent } from '../server/agents/stdio.ts'
import { runGame } from '../server/sim/runner.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import type { Seat } from '../server/engine/types.ts'

const dummyPath = fileURLToPath(new URL('../server/agents/dummy-stdio-agent.mjs', import.meta.url))

test('a stdio child process can drive a seat through a full game', async () => {
  const seed = 'stdio-1'
  const game = createGame({ seed, playerCount: 5, talk: { maxRounds: 1, maxRoundsAfterChange: 0 } })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((p) => [
      p.seat,
      p.seat === 1
        ? createStdioAgent({ cmd: process.execPath, args: [dummyPath], label: 'dummy' })
        : createHeuristicAgent({ seed, seat: p.seat }),
    ]),
  )
  const result = await runGame({ game, agents })
  assert.equal(result.game.phase, 'gameOver')
  assert.equal(result.degraded.length, 0, JSON.stringify(result.degraded))
  // The dummy declares discuss:false, so its table-talk turns are auto-passes.
  const seat1Talk = game.log.filter((ev) => ev.type === 'utterance' && ev.payload.seat === 1)
  assert.ok(seat1Talk.every((ev) => ev.payload.text === ''))
})

test('a dead external agent degrades to the heuristic instead of stalling', async () => {
  const seed = 'stdio-dead'
  const game = createGame({ seed, playerCount: 5, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((p) => [
      p.seat,
      p.seat === 2
        ? createStdioAgent({
            cmd: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 60000)'], // never says hello
            label: 'dead', timeoutMs: 400,
          })
        : createHeuristicAgent({ seed, seat: p.seat }),
    ]),
  )
  const result = await runGame({ game, agents })
  assert.equal(result.game.phase, 'gameOver')
  assert.ok(result.degraded.length > 0)
  assert.ok(result.degraded.every((d) => d.seat === 2))
})
