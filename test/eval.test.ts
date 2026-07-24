// Eval substrate: artifacts, commitment ledger, metrics, paired bench.
// Everything here runs API-free (heuristic agents + synthetic logs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGame } from '../server/engine/game.ts'
import { createAgent } from '../server/agents/registry.ts'
import { runGame } from '../server/sim/runner.ts'
import { appendArtifact, readArtifacts, toArtifact } from '../server/eval/artifact.ts'
import { buildLedger } from '../server/eval/ledger.ts'
import { computeMetrics } from '../server/eval/metrics.ts'
import { runBench } from '../server/eval/bench.ts'
import type { GameArtifact } from '../server/eval/artifact.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import type { GameEvent, Seat } from '../server/engine/types.ts'

// ---- helpers ----

type Ev = Omit<GameEvent, 'seq' | 'visibility'> & { visibility?: GameEvent['visibility'] }
const mkLog = (events: Ev[]): GameEvent[] =>
  events.map((e, seq) => ({ seq, visibility: 'public', ...e }))

const say = (seat: Seat, text: string, lean?: string): Ev =>
  ({ type: 'utterance', payload: { seat, text, round: 1, ...(lean ? { lean } : {}) } })

const proposal = (leader: Seat, team: Seat[], round = 1, proposalNum = 1): Ev =>
  ({ type: 'proposal', payload: { round, proposalNum, leader, team } })

const voteReveal = (team: Seat[], votes: Record<Seat, 'approve' | 'reject'>, approved: boolean, round = 1, proposalNum = 1): Ev =>
  ({ type: 'voteReveal', payload: {
    round, proposalNum, team, approved,
    votes: Object.entries(votes).map(([s, vote]) => ({ seat: Number(s), vote })),
  } })

const questResult = (round: number, result: 'success' | 'fail'): Ev =>
  ({ type: 'questResult', payload: { round, result, failCount: result === 'fail' ? 1 : 0, failsRequired: 1 } })

// ---- ledger ----

test('ledger flags a pass after the passer\'s endorsed team failed', () => {
  // The motivating incident: seat 2 leaned approve AND voted approve on a
  // team that then failed — and said nothing. Seat 3 voted reject: owes nothing.
  const log = mkLog([
    proposal(0, [0, 1]),
    say(2, 'this team is fine, let\'s run it', 'approve'),
    voteReveal([0, 1], { 0: 'approve', 1: 'approve', 2: 'approve', 3: 'reject', 4: 'reject' }, true),
    questResult(1, 'fail'),
    say(2, ''),   // silent after contradiction -> flagged
    say(3, ''),   // rejected the team -> no obligation
  ])
  const ledger = buildLedger(log)
  assert.equal(ledger.silentAfterContradiction.length, 1)
  const flag = ledger.silentAfterContradiction[0]
  assert.equal(flag.seat, 2)
  // Both the lean and the vote were contradicted.
  assert.deepEqual(flag.contradictions.map((c) => c.commitment.via).sort(), ['lean', 'vote'])
  assert.ok(flag.contradictions.every((c) => c.kind === 'endorsedTeamFailed'))
})

test('ledger: speaking discharges the obligation; every silent pass before that is flagged', () => {
  const log = mkLog([
    proposal(0, [0, 2]),
    voteReveal([0, 2], { 0: 'approve', 1: 'approve', 2: 'approve', 3: 'reject', 4: 'reject' }, true),
    questResult(1, 'fail'),
    say(0, ''),                          // flagged (leader proposed = endorsed)
    say(0, ''),                          // still silent -> flagged again
    say(0, 'okay, that fail is on me to explain'),
    say(0, ''),                          // spoke since the contradiction -> clean
  ])
  const flags = buildLedger(log).silentAfterContradiction
  assert.deepEqual(flags.map((f) => f.seat), [0, 0])
})

test('ledger: rejected proposals never resolve, so their commitments cannot be contradicted', () => {
  const log = mkLog([
    proposal(0, [0, 1]),
    say(2, 'looks good', 'approve'),
    voteReveal([0, 1], { 0: 'approve', 1: 'reject', 2: 'approve', 3: 'reject', 4: 'reject' }, false),
    proposal(1, [1, 3], 1, 2),
    voteReveal([1, 3], { 0: 'approve', 1: 'approve', 2: 'approve', 3: 'approve', 4: 'reject' }, true, 1, 2),
    questResult(1, 'fail'),
    say(2, ''), // approved BOTH proposals; only the second played and failed
  ])
  const ledger = buildLedger(log)
  const flagged = ledger.silentAfterContradiction[0]
  assert.equal(flagged.seat, 2)
  assert.ok(flagged.contradictions.every((c) => c.commitment.proposalNum === 2))
})

test('ledger: a clean success contradicts rejectors but never triggers silence flags', () => {
  const log = mkLog([
    proposal(0, [0, 1]),
    voteReveal([0, 1], { 0: 'approve', 1: 'approve', 2: 'approve', 3: 'reject', 4: 'reject' }, true),
    questResult(1, 'success'),
    say(3, ''), // strategic caution proven wrong is not an obligation
  ])
  const ledger = buildLedger(log)
  assert.equal(ledger.silentAfterContradiction.length, 0)
  assert.ok(ledger.contradictions.some((c) => c.kind === 'opposedTeamSucceeded' && c.commitment.seat === 3))
})

// ---- metrics ----

function syntheticArtifact(log: GameEvent[]): GameArtifact {
  const roles = ['merlin', 'percival', 'servant', 'morgana', 'assassin'] as const
  return {
    schema: 2, id: 'g', seed: 's', createdAt: new Date().toISOString(),
    playerCount: 5, roles: [...roles], talk: { maxRounds: 1, maxRoundsAfterChange: 0 },
    players: roles.map((role, seat) => ({
      seat, name: `P${seat}`, role,
      alignment: role === 'morgana' || role === 'assassin' ? 'evil' : 'good',
      agent: 'heuristic',
    })),
    winner: 'good', winReason: 'threeQuests', steps: 0, degraded: [], log,
  }
}

test('conspicuousness: a Merlin whose votes track ground truth ranks #1 among good', () => {
  // Team [3,4] is all-evil, team [0,1] is clean. Merlin (0) discriminates
  // perfectly; the servant (2) is always wrong; percival (1) is mixed.
  const log = mkLog([
    voteReveal([3, 4], { 0: 'reject', 1: 'reject', 2: 'approve', 3: 'approve', 4: 'approve' }, false),
    voteReveal([0, 1], { 0: 'approve', 1: 'reject', 2: 'reject', 3: 'reject', 4: 'reject' }, false, 1, 2),
  ])
  const m = computeMetrics(syntheticArtifact(log))
  assert.equal(m.merlin!.voteScore, 1)
  assert.equal(m.merlin!.conspicuousnessRank, 1)
  assert.equal(m.merlin!.goodPlayers, 3)
  assert.equal(m.merlin!.assassinated, null) // never reached assassination
  const servant = m.seats.find((s) => s.role === 'servant')!
  assert.equal(servant.voteScore, 0)
})

test('conspicuousness: a Merlin tied at the top is NOT scored uniquely most-conspicuous', () => {
  // Merlin (0) and servant (2) BOTH vote perfectly; percival (1) is wrong.
  // Midrank must place the 2-way top tie at 1.5, not 1 — a Merlin that blends
  // into a tied pack should not read the same as one uniquely topping the table.
  const log = mkLog([
    voteReveal([3, 4], { 0: 'reject', 1: 'approve', 2: 'reject', 3: 'approve', 4: 'approve' }, false),
    voteReveal([0, 1], { 0: 'approve', 1: 'reject', 2: 'approve', 3: 'reject', 4: 'reject' }, false, 1, 2),
  ])
  const m = computeMetrics(syntheticArtifact(log))
  assert.equal(m.merlin!.voteScore, 1)
  assert.equal(m.merlin!.conspicuousnessRank, 1.5)
})

test('metrics: leans count only while a team is on the table', () => {
  const log = mkLog([
    say(2, 'pre-proposal chatter', 'approve'), // no pendingTeam -> not counted
    proposal(0, [3, 4]),
    say(2, 'hmm', 'reject'),                   // correct: team has evil
    voteReveal([3, 4], { 0: 'reject', 1: 'reject', 2: 'reject', 3: 'approve', 4: 'approve' }, false),
  ])
  const m = computeMetrics(syntheticArtifact(log))
  const s2 = m.seats.find((s) => s.seat === 2)!
  assert.equal(s2.leans, 1)
  assert.equal(s2.leanScore, 1)
})

// ---- artifact roundtrip on a real game ----

test('artifact: real heuristic game roundtrips through JSONL and computes metrics', async () => {
  const game = createGame({ seed: 'eval-rt', playerCount: 7, talk: { maxRounds: 1, maxRoundsAfterChange: 0 } })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((p) => [p.seat, createAgent({ type: 'heuristic' }, { seed: 'eval-rt', seat: p.seat })]),
  )
  const result = await runGame({ game, agents })
  const artifact = toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: result.degraded, steps: result.steps,
  })

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-eval-'))
  const file = path.join(dir, 'games.jsonl')
  appendArtifact(file, artifact)
  appendArtifact(file, artifact)
  const back = readArtifacts(file)
  assert.equal(back.length, 2)
  assert.deepEqual(back[0], JSON.parse(JSON.stringify(artifact)))

  const m = computeMetrics(back[0])
  assert.equal(m.seats.length, 7)
  assert.ok(m.winner === 'good' || m.winner === 'evil')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('artifact: refuses an unfinished game', () => {
  const game = createGame({ seed: 'x', playerCount: 5 })
  assert.throws(() => toArtifact(game, { agents: ['h', 'h', 'h', 'h', 'h'], degraded: [], steps: 0 }))
})

// ---- paired bench ----

test('bench: paired runs share the deal and differ only in tags', async () => {
  const heuristicDef = (id: string) =>
    ({ id, name: id, engine: { type: 'heuristic' as const } })
  const artifacts = await runBench({
    role: 'merlin',
    candidate: heuristicDef('cand'),
    baseline: heuristicDef('base'),
    games: 2,
    seedBase: 'bench-test',
    playerCount: 5,
    talk: { maxRounds: 1, maxRoundsAfterChange: 0 },
  })
  assert.equal(artifacts.length, 4)

  for (const seed of ['bench-test-0', 'bench-test-1']) {
    const pair = artifacts.filter((a) => a.tags!.pairSeed === seed)
    assert.equal(pair.length, 2)
    const [a, b] = pair
    assert.notEqual(a.tags!.variant, b.tags!.variant)
    // Same seed -> identical deal; identical (heuristic) agents -> identical game.
    assert.deepEqual(
      a.players.map((p) => ({ seat: p.seat, role: p.role })),
      b.players.map((p) => ({ seat: p.seat, role: p.role })),
    )
    assert.deepEqual(a.log, b.log)
    // The agent under test sits at the seat that DREW merlin.
    const merlinSeat = a.players.find((p) => p.role === 'merlin')!.seat
    assert.equal(a.players[merlinSeat].agent, `def:${a.tags!.agentId}`)
    for (const p of a.players) {
      if (p.seat !== merlinSeat) assert.equal(p.agent, 'heuristic')
    }
  }
})
