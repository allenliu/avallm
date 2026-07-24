// The facts dossier: computed public signals fed to LLM prompts. Pure, API-free.
// The load-bearing test is the LEAK check — the dossier must contain only
// public-derivable facts, never roles/alignment/private knowledge.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import { runGame } from '../server/sim/runner.ts'
import { factsDossier } from '../server/agents/facts.ts'
import type { PlayerView, ProposalRecord, Quest, Seat } from '../server/engine/types.ts'

// Minimal synthetic view — only the fields the dossier reads.
function view(over: Partial<PlayerView>): PlayerView {
  return {
    seat: 0, name: 'P0', role: 'servant', alignment: 'good', privateInfo: {},
    playerCount: 5, rolesInPlay: [], players: Array.from({ length: 5 }, (_, s) => ({ seat: s, name: `P${s}` })),
    phase: 'vote', round: 2, proposalNum: 1, leaderSeat: 0,
    quests: [], proposals: [], transcript: [], events: [],
    ...over,
  } as PlayerView
}

const quest = (num: number, teamSize: number, over: Partial<Quest>): Quest =>
  ({ num, teamSize, failsRequired: 1, ...over })

const proposal = (over: Partial<ProposalRecord>): ProposalRecord =>
  ({ round: 1, proposalNum: 1, leader: 0, team: [], approved: true, ...over }) as ProposalRecord

test('dossier is empty before anything resolves', () => {
  assert.equal(factsDossier(view({ quests: [quest(1, 2, {}), quest(2, 3, {})] })), '')
})

test('AVALON_NO_DOSSIER=1 suppresses the dossier (the eval A/B lever)', () => {
  const withData = view({ quests: [quest(1, 2, { team: [0, 1], result: 'fail', failCount: 1 })] })
  assert.notEqual(factsDossier(withData), '') // on by default
  const prev = process.env.AVALON_NO_DOSSIER
  process.env.AVALON_NO_DOSSIER = '1'
  try {
    assert.equal(factsDossier(withData), '')
  } finally {
    if (prev === undefined) delete process.env.AVALON_NO_DOSSIER
    else process.env.AVALON_NO_DOSSIER = prev
  }
})

test('dossier reports fail exposure and never-on-quest from resolved quests', () => {
  const d = factsDossier(view({
    quests: [
      quest(1, 2, { team: [0, 3], result: 'fail', failCount: 1 }),
      quest(2, 2, { team: [3, 4], result: 'success', failCount: 0 }),
    ],
  }))
  assert.match(d, /P0\(seat 0\): on Q1\(FAIL\)/)
  assert.match(d, /P3\(seat 3\): on Q1\(FAIL\), Q2\(ok\)/)
  assert.match(d, /Never on a quest: P1\(seat 1\), P2\(seat 2\)\./)
})

test('dossier computes vote/lead signals only for approved resolved proposals', () => {
  const d = factsDossier(view({
    quests: [quest(1, 2, { team: [1, 2], result: 'fail', failCount: 1 })],
    proposals: [
      // seat 3 led this failed team and seat 4 approved it while off it.
      proposal({ round: 1, leader: 3, team: [1, 2], approved: true,
        votes: [
          { seat: 0, vote: 'reject' }, { seat: 1, vote: 'approve' }, { seat: 2, vote: 'approve' },
          { seat: 3, vote: 'approve' }, { seat: 4, vote: 'approve' },
        ] }),
    ],
  }))
  assert.match(d, /P3\(seat 3\): led 1 failed quest/)
  assert.match(d, /P4\(seat 4\): approved 1 failed team it was not on/)
  // seat 1/2 were ON the team, so they get exposure, not an off-team-approval signal.
  assert.doesNotMatch(d, /P1\(seat 1\): approved/)
})

test('dossier surfaces the deciding seat\'s own contradicted positions', () => {
  const d = factsDossier(view({
    seat: 0,
    quests: [
      quest(1, 2, { team: [1, 2], result: 'fail', failCount: 1 }),
      quest(2, 2, { team: [3, 4], result: 'success', failCount: 0 }),
    ],
    proposals: [
      proposal({ round: 1, leader: 1, team: [1, 2], approved: true,
        votes: [{ seat: 0, vote: 'approve' }, { seat: 1, vote: 'approve' }, { seat: 2, vote: 'approve' }, { seat: 3, vote: 'reject' }, { seat: 4, vote: 'reject' }] }),
      proposal({ round: 2, leader: 3, team: [3, 4], approved: true,
        votes: [{ seat: 0, vote: 'reject' }, { seat: 1, vote: 'reject' }, { seat: 2, vote: 'approve' }, { seat: 3, vote: 'approve' }, { seat: 4, vote: 'approve' }] }),
    ],
  }))
  assert.match(d, /You APPROVED the Q1 team \[P1\/P2\] → it FAILED\./)
  assert.match(d, /You REJECTED the Q2 team \[P3\/P4\] → it SUCCEEDED\./)
})

test('hammer proximity appears only when the runway is short', () => {
  const q = [quest(1, 2, { team: [0, 1], result: 'fail', failCount: 1 })]
  assert.doesNotMatch(factsDossier(view({ quests: q, proposalNum: 2 })), /Hammer proximity/)
  assert.match(factsDossier(view({ quests: q, proposalNum: 3 })), /up to 2 more proposals can be rejected/)
  assert.match(factsDossier(view({ quests: q, proposalNum: 4 })), /up to 1 more proposal can be rejected/)
  assert.doesNotMatch(factsDossier(view({ quests: q, proposalNum: 5 })), /Hammer proximity/) // it IS the hammer
})

// The invariant: NO hidden information. Play real games and assert the dossier
// for every seat never names another player's role/alignment or private data.
test('dossier leaks no hidden information across a full game, every seat', async () => {
  for (const seed of ['facts-a', 'facts-b', 'facts-c']) {
    const game = createGame({ seed, playerCount: 7, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
    const agents = new Map<Seat, ReturnType<typeof heuristicAgent>>()
    function heuristicAgent(seat: Seat) {
      return { async decide(req: any, v: PlayerView) {
        // Check the dossier at every decision point for every deciding seat.
        const d = factsDossier(v)
        for (const p of game.players) {
          if (p.seat === v.seat) continue
          // The dossier must never assert another player's secret role/alignment.
          assert.doesNotMatch(d, new RegExp(`${p.name}\\(seat ${p.seat}\\)[^\\n]*\\b(MERLIN|MORGANA|ASSASSIN|MORDRED|OBERON|MINION|PERCIVAL|evil|good)\\b`, 'i'),
            `seat ${v.seat} dossier leaked role/alignment of seat ${p.seat} (${seed})`)
        }
        return heuristicDecide(req, v, seed)
      } }
    }
    for (const p of game.players) agents.set(p.seat, heuristicAgent(p.seat))
    await runGame({ game, agents })
  }
})
