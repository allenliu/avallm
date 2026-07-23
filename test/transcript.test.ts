// The copyable debug transcript: the pure renderer, and the HTTP route's
// fidelity policy (full reveal when final or solo-vs-bots; scoped otherwise).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { createAgent } from '../server/agents/registry.ts'
import { runGame } from '../server/sim/runner.ts'
import { renderTranscript, type TranscriptSeat } from '../server/transcript.ts'
import { server } from '../server/server.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import type { Seat } from '../server/engine/types.ts'

async function finishedGame(seed = 'transcript', playerCount = 5) {
  const game = createGame({ seed, playerCount, talk: { preProposal: 0, postProposal: 0 } })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((p) => [p.seat, createAgent({ type: 'heuristic' }, { seed, seat: p.seat })]),
  )
  const result = await runGame({ game, agents })
  return result.game
}

function seatsFor(game: Awaited<ReturnType<typeof finishedGame>>, revealed: boolean): TranscriptSeat[] {
  return game.players.map((p) => ({
    seat: p.seat, name: p.name, agent: 'rule-based',
    ...(revealed ? { role: p.role, alignment: p.alignment } : {}),
  }))
}

test('full-reveal transcript exposes roles, the whole log, and the raw JSONL', async () => {
  const game = await finishedGame()
  const text = renderTranscript({
    id: game.id, seed: game.seed, playerCount: game.config.playerCount,
    phase: game.phase, round: game.round, proposalNum: game.proposalNum,
    leaderSeat: game.leaderSeat, quests: game.quests, seats: seatsFor(game, true),
    log: game.log, winner: game.winner, winReason: game.winReason,
    revealed: true, capturedAt: '2026-07-23T00:00:00.000Z', includeRaw: true,
  })
  assert.match(text, /FULL REVEAL/)
  assert.match(text, new RegExp(`\\*\\*${game.winner!.toUpperCase()}\\*\\*`))
  assert.match(text, /\*\*\* (GOOD|EVIL) wins/)
  // Every seat's role appears (from the seat table) and the raw JSONL carries
  // exactly one line per logged event.
  for (const p of game.players) assert.ok(text.includes(p.role), `role ${p.role} present`)
  const jsonl = text.split('```jsonl\n')[1].split('\n```')[0].trim().split('\n')
  assert.equal(jsonl.length, game.log.length)
  assert.equal(JSON.parse(jsonl[0]).type, 'gameCreated')
})

test('scoped transcript hides roles and other seats\' private events', async () => {
  const game = await finishedGame()
  const seat: Seat = 0
  const scopedLog = viewFor(game, seat).events
  const text = renderTranscript({
    id: game.id, seed: game.seed, playerCount: game.config.playerCount,
    phase: 'vote', round: 2, proposalNum: 1,
    leaderSeat: game.leaderSeat, quests: game.quests, seats: seatsFor(game, false),
    log: scopedLog, revealed: false, scopedTo: seat,
    capturedAt: '2026-07-23T00:00:00.000Z', includeRaw: true,
  })
  assert.match(text, /SCOPED/)
  assert.doesNotMatch(text, /FULL REVEAL/)
  // The scoped log only carries public events plus seat 0's own private ones,
  // so no other seat's roleDealt leaks in the raw JSONL.
  const jsonl = text.split('```jsonl\n')[1].split('\n```')[0].trim().split('\n').map((l) => JSON.parse(l))
  const foreignDeal = jsonl.some((ev) => ev.type === 'roleDealt' && ev.payload.seat !== seat)
  assert.equal(foreignDeal, false, 'no other seat roleDealt in a scoped log')
})

test('backticks in free-form text do not break the code fences', async () => {
  const game = await finishedGame()
  // A pitch containing a triple backtick would close a fixed ``` fence early.
  game.log.push({
    seq: game.log.length,
    type: 'utterance',
    payload: { seat: 0, text: 'try ```rm -rf``` lol', slot: 'pre', round: 1 },
    visibility: 'public',
  })
  const text = renderTranscript({
    id: game.id, seed: game.seed, playerCount: game.config.playerCount,
    phase: game.phase, round: game.round, proposalNum: game.proposalNum,
    leaderSeat: game.leaderSeat, quests: game.quests, seats: seatsFor(game, true),
    log: game.log, winner: game.winner, winReason: game.winReason,
    revealed: true, capturedAt: '2026-07-23T00:00:00.000Z', includeRaw: true,
  })
  // The play-by-play fence must be longer than the 3-backtick run in the body,
  // and the whole document must still parse into a clean set of fenced blocks
  // (an even number of fence lines).
  assert.match(text, /````+\n/, 'fence widened past three backticks')
  const openPbp = text.indexOf('\n## Play-by-play\n')
  const pbpBlock = text.slice(openPbp)
  assert.ok(pbpBlock.includes('try ```rm -rf``` lol'), 'content survives intact')
})

// ---- HTTP route ----
let base: string
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function newSoloGame() {
  const res = await fetch(`${base}/api/game/new`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerCount: 5, table: ['autopilot', 'autopilot', 'autopilot', 'autopilot'], humanName: 'Tester' }),
  })
  return res.json() as Promise<{ id: string; token: string }>
}

test('a lone human gets a mid-game FULL REVEAL transcript', async () => {
  const { id, token } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/transcript?token=${token}`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type') ?? '', /text\/plain/)
  const text = await r.text()
  assert.match(text, /FULL REVEAL/) // solo table: nobody to cheat
  assert.match(text, /# Avalon debug transcript/)
})

test('/transcript rejects a wrong token mid-game', async () => {
  const { id } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/transcript?token=nope`)
  assert.equal(r.status, 403)
})
