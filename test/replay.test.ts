// Replay, record rendering, and situation-bank mining. All API-free.
//
// The replay contract is the foundation the situation bank stands on: a
// snapshot must show EXACTLY what the deciding agent saw. So the core test
// records every (req, view) live during a real game, then asserts snapshotAt
// reproduces each view bit-for-bit from the artifact alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import { runGame } from '../server/sim/runner.ts'
import { toArtifact } from '../server/eval/artifact.ts'
import { replayGame, snapshotAt } from '../server/eval/replay.ts'
import { publicRecord, fullRecord } from '../server/eval/record.ts'
import { mineBank, replayItem } from '../server/eval/bank.ts'
import type { GameArtifact, JudgeResult } from '../server/eval/artifact.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import type { DecisionRequest, PlayerView, Seat } from '../server/engine/types.ts'

interface Captured {
  req: DecisionRequest
  view: PlayerView
}

async function playAndCapture(seed: string, playerCount: number): Promise<{ artifact: GameArtifact; captured: Captured[] }> {
  const captured: Captured[] = []
  const game = createGame({ seed, playerCount, talk: { preProposal: 1, postProposal: 1 } })
  const agents = new Map<Seat, AvalonAgent>(game.players.map((p) => [p.seat, {
    async decide(req, view) {
      captured.push({ req, view: JSON.parse(JSON.stringify(view)) })
      return heuristicDecide(req, view, seed)
    },
  }]))
  const result = await runGame({ game, agents })
  const artifact = toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: result.degraded, steps: result.steps,
  })
  return { artifact: JSON.parse(JSON.stringify(artifact)), captured }
}

test('replay reproduces archived games event-for-event', async () => {
  for (const [seed, playerCount] of [['r1', 5], ['r2', 7], ['r3', 10]] as const) {
    const { artifact } = await playAndCapture(seed, playerCount)
    const game = replayGame(artifact) // drift is a hard error inside
    assert.equal(game.log.length, artifact.log.length, `${seed}: full replay`)
    assert.equal(game.winner, artifact.winner)
  }
})

test('snapshotAt reproduces every decision view bit-for-bit', async () => {
  const { artifact, captured } = await playAndCapture('snap', 7)
  // Decision action events, in order, correspond 1:1 to captured decisions.
  const actionSeqs = artifact.log
    .filter((ev) => ['utterance', 'proposal', 'voteCast', 'questCard', 'assassination'].includes(ev.type))
    .map((ev) => ev.seq)
  assert.equal(actionSeqs.length, captured.length)
  // Spot-check a spread of decisions (full sweep would be slow: one replay each).
  // JSON roundtrip before comparing: the live view carries undefined-valued
  // keys (winner, currentTeam…) that serialization drops, and serialized
  // content is exactly the fidelity the bank stores and replays.
  const picks = [0, 1, Math.floor(actionSeqs.length / 2), actionSeqs.length - 2, actionSeqs.length - 1]
  for (const i of picks) {
    const snap = snapshotAt(artifact, actionSeqs[i])
    assert.equal(snap.seat, captured[i].req.seat, `decision ${i}: seat`)
    assert.equal(snap.kind, captured[i].req.kind, `decision ${i}: kind`)
    assert.deepEqual(JSON.parse(JSON.stringify(snap.req)), captured[i].req, `decision ${i}: request`)
    assert.deepEqual(JSON.parse(JSON.stringify(snap.view)), captured[i].view, `decision ${i}: view`)
  }
})

test('snapshotAt rejects engine-emitted (non-decision) events', async () => {
  const { artifact } = await playAndCapture('snap2', 5)
  const voteReveal = artifact.log.find((ev) => ev.type === 'voteReveal')!
  assert.throws(() => snapshotAt(artifact, voteReveal.seq), /not a decision event/)
})

test('publicRecord with excludeOutcome hides the endgame; fullRecord shows private events', async () => {
  const { artifact } = await playAndCapture('rec', 7)
  const blind = publicRecord(artifact, { excludeOutcome: true })
  assert.ok(!blind.includes('GAME OVER'))
  assert.ok(!blind.includes('assassination:'))
  assert.ok(!blind.includes('Result:'))
  assert.ok(!blind.includes('[private'))
  assert.ok(!blind.includes('MERLIN'))
  const full = fullRecord(artifact)
  assert.ok(full.includes('GAME OVER'))
  assert.ok(full.includes('= MERLIN (good)'))
  assert.ok(full.includes('[private] ')) // voteCast / questCard lines
})

test('bank: judged incidents mine into replayable snapshots; non-decision seqs are skipped', async () => {
  const { artifact } = await playAndCapture('bank', 7)
  const utterance = artifact.log.find((ev) => ev.type === 'utterance')!
  const voteReveal = artifact.log.find((ev) => ev.type === 'voteReveal')!
  const judge: JudgeResult = {
    model: 'test',
    blinded: { evil: [], merlin: null, confidence: 0, evilCorrect: 0, merlinCorrect: false },
    scorecards: [],
    incidents: [
      { seat: utterance.payload.seat as number, seq: utterance.seq, family: 'commitment-failure', description: 'test incident' },
      { seat: 0, seq: voteReveal.seq, family: 'blunder', description: 'cites a consequence, not a decision' },
      { seat: 0, seq: 3, family: 'good-play', description: 'excluded by family' },
    ],
    ranAt: new Date().toISOString(),
  }
  artifact.judge = judge

  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-bank-'))
  const file = path.join(dir, 'a.jsonl')
  fs.writeFileSync(file, JSON.stringify(artifact) + '\n')

  const { items, skipped, failures } = mineBank([file], [])
  assert.equal(items.length, 1)
  assert.equal(skipped, 1)          // the voteReveal incident: a non-decision event
  assert.equal(failures.length, 0)  // no real replay failures
  const item = items[0]
  assert.equal(item.family, 'commitment-failure')
  assert.equal(item.snapshot.kind, 'discuss')
  assert.equal(item.snapshot.seq, utterance.seq)

  // Re-mining with the existing bank dedupes.
  assert.equal(mineBank([file], items).items.length, 0)

  // A heuristic candidate replays the situation without any API.
  const replayed = await replayItem(item, { id: 'h', name: 'h', engine: { type: 'heuristic' } })
  assert.equal(replayed.decision?.kind, 'discuss')
  fs.rmSync(dir, { recursive: true, force: true })
})
