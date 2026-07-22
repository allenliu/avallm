// Scripted-game tests for the rules that are easy to get wrong:
// strict-majority voting, the five-rejection loss, quest-card coercion,
// the double-fail quest, and the assassination phase.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDecision, createGame, expectedDecisions } from '../server/engine/game.ts'
import type { Game, Seat } from '../server/engine/types.ts'

function mk(playerCount = 7, seed = 'flow'): Game {
  return createGame({ seed, playerCount, talk: { preProposal: 0, postProposal: 0 } })
}

function propose(g: Game, team: Seat[]): void {
  applyDecision(g, g.leaderSeat, { kind: 'propose', team })
}

function voteAll(g: Game, voteFor: (seat: Seat) => 'approve' | 'reject'): void {
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: voteFor(p.seat) })
}

function playQuest(g: Game, cardFor: (seat: Seat) => 'success' | 'fail'): void {
  for (const seat of g.currentTeam!) {
    applyDecision(g, seat, { kind: 'quest', card: cardFor(seat) })
  }
}

const evilSeats = (g: Game) => g.players.filter((p) => p.alignment === 'evil').map((p) => p.seat)
const goodSeats = (g: Game) => g.players.filter((p) => p.alignment === 'good').map((p) => p.seat)

// Runs one full quest round: propose `team`, approve unanimously, play cards.
function runRound(g: Game, team: Seat[], failers: Seat[]): void {
  propose(g, team)
  voteAll(g, () => 'approve')
  playQuest(g, (s) => (failers.includes(s) ? 'fail' : 'success'))
}

test('a tied vote rejects the team', () => {
  const g = mk(6, 'tie')
  propose(g, [0, 1])
  const votes: Record<number, 'approve' | 'reject'> =
    { 0: 'approve', 1: 'approve', 2: 'approve', 3: 'reject', 4: 'reject', 5: 'reject' }
  voteAll(g, (s) => votes[s])
  assert.equal(g.phase, 'proposal') // rejected: back to proposal, not quest
  assert.equal(g.proposalNum, 2)
})

test('a strict majority approves', () => {
  const g = mk(7, 'majority')
  propose(g, [0, 1])
  voteAll(g, (s) => (s < 4 ? 'approve' : 'reject')) // 4 of 7
  assert.equal(g.phase, 'quest')
})

test('the 5th rejected proposal ends the game for evil, leader rotating each time', () => {
  const g = mk(7, 'hammer')
  const leaders: Seat[] = []
  for (let i = 1; i <= 5; i++) {
    assert.equal(g.proposalNum, i)
    leaders.push(g.leaderSeat)
    propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 7])
    voteAll(g, () => 'reject')
  }
  assert.equal(g.phase, 'gameOver')
  assert.equal(g.winner, 'evil')
  assert.equal(g.winReason, 'fiveRejections')
  for (let i = 1; i < leaders.length; i++) {
    assert.equal(leaders[i], (leaders[i - 1] + 1) % 7, 'leader rotates after each rejection')
  }
})

test('good quest cards are coerced to success', () => {
  const g = mk(7, 'coerce')
  const good = goodSeats(g).slice(0, 2)
  propose(g, good)
  voteAll(g, () => 'approve')
  playQuest(g, () => 'fail') // both good players try to play fail
  const q1 = g.quests[0]
  assert.equal(q1.result, 'success')
  assert.equal(q1.failCount, 0)
  const cards = g.log.filter((ev) => ev.type === 'questCard')
  for (const ev of cards) assert.equal(ev.payload.card, 'success')
})

test('quest 4 at 7 players survives one fail but not two; assassination decides the game', () => {
  const g = mk(7, 'doublefail')
  const evil = evilSeats(g)
  const good = goodSeats(g)

  runRound(g, good.slice(0, 2), [])                        // Q1 success
  runRound(g, [evil[0], good[0], good[1]], [evil[0]])      // Q2 fail
  runRound(g, good.slice(0, 3), [])                        // Q3 success
  assert.equal(g.round, 4)
  assert.equal(g.quests[3].failsRequired, 2)

  // One fail on quest 4 is not enough at 7 players.
  runRound(g, [evil[0], good[0], good[1], good[2]], [evil[0]])
  const q4 = g.quests[3]
  assert.equal(q4.failCount, 1)
  assert.equal(q4.result, 'success')

  // Third success: not an instant good win — assassination phase.
  assert.equal(g.phase, 'assassination')
  const assassin = g.players.find((p) => p.role === 'assassin')!
  assert.deepEqual(expectedDecisions(g), [
    { kind: 'assassinate', seat: assassin.seat, round: g.round, proposalNum: g.proposalNum },
  ])

  // Missing Merlin: good wins.
  const notMerlin = g.players.find((p) => p.role === 'servant')!
  applyDecision(g, assassin.seat, { kind: 'assassinate', target: notMerlin.seat })
  assert.equal(g.winner, 'good')
  assert.equal(g.winReason, 'assassinMissed')
})

test('two fails break quest 4 at 7 players', () => {
  const g = mk(7, 'doublefail2')
  const evil = evilSeats(g)
  const good = goodSeats(g)
  runRound(g, good.slice(0, 2), [])                                   // Q1 success
  runRound(g, [evil[0], good[0], good[1]], [evil[0]])                 // Q2 fail
  runRound(g, good.slice(0, 3), [])                                   // Q3 success
  runRound(g, [evil[0], evil[1], good[0], good[1]], [evil[0], evil[1]]) // Q4: 2 fails
  assert.equal(g.quests[3].result, 'fail')
  assert.equal(g.phase, 'proposal') // 2-2, game continues to quest 5
  assert.equal(g.round, 5)
})

test('assassinating Merlin steals the game for evil', () => {
  const g = mk(5, 'shoot')
  const good = goodSeats(g)
  runRound(g, good.slice(0, 2), [])
  runRound(g, good.slice(0, 3), [])
  runRound(g, good.slice(0, 2), [])
  assert.equal(g.phase, 'assassination')
  const assassin = g.players.find((p) => p.role === 'assassin')!
  const merlin = g.players.find((p) => p.role === 'merlin')!
  applyDecision(g, assassin.seat, { kind: 'assassinate', target: merlin.seat })
  assert.equal(g.winner, 'evil')
  assert.equal(g.winReason, 'merlinAssassinated')
})

test('three failed quests end the game immediately, no assassination', () => {
  const g = mk(7, 'threefails')
  const evil = evilSeats(g)
  const good = goodSeats(g)
  runRound(g, [evil[0], good[0]], [evil[0]])
  runRound(g, [evil[0], good[0], good[1]], [evil[0]])
  runRound(g, [evil[0], good[0], good[1]], [evil[0]])
  assert.equal(g.phase, 'gameOver')
  assert.equal(g.winner, 'evil')
  assert.equal(g.winReason, 'threeFails')
})

test('illegal decisions are rejected without corrupting state', () => {
  const g = mk(7, 'illegal')
  const logLen = g.log.length
  assert.throws(() => applyDecision(g, g.leaderSeat, { kind: 'propose', team: [0] }), /exactly/)
  assert.throws(() => applyDecision(g, g.leaderSeat, { kind: 'propose', team: [0, 0] }), /duplicate|exactly/)
  assert.throws(() => applyDecision(g, g.leaderSeat, { kind: 'propose', team: [0, 99] }), /invalid seat|exactly/)
  const notLeader = (g.leaderSeat + 1) % 7
  assert.throws(() => applyDecision(g, notLeader, { kind: 'propose', team: [0, 1] }), /unexpected/)
  assert.throws(() => applyDecision(g, 0, { kind: 'vote', vote: 'approve' }), /unexpected/)
  assert.equal(g.log.length, logLen)
  assert.equal(g.phase, 'proposal')
})

test('post-proposal talk runs extra rounds while people speak, ends early when silent', () => {
  const g = createGame({ seed: 'rounds', playerCount: 5, talk: { preProposal: 0, postProposal: 3 } })
  propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 5])
  assert.equal(g.phase, 'discussion')

  // Round 1: one player speaks (with a lean), others pass — earns round 2.
  for (let i = 0; i < 5; i++) {
    const [req] = expectedDecisions(g)
    applyDecision(g, req.seat, {
      kind: 'discuss',
      say: i === 2 ? 'I do not like this team.' : '',
      lean: i === 2 ? 'reject' : undefined,
    })
  }
  assert.equal(g.phase, 'discussion')
  assert.equal(g.discussion!.roundNum, 2)

  // Round 2: everyone passes — discussion ends despite maxRounds=3.
  for (let i = 0; i < 5; i++) {
    const [req] = expectedDecisions(g)
    applyDecision(g, req.seat, { kind: 'discuss', say: '' })
  }
  assert.equal(g.phase, 'vote')

  // The lean was recorded publicly on the utterance.
  const leaned = g.log.find((ev) => ev.type === 'utterance' && ev.payload.lean !== undefined)
  assert.ok(leaned)
  assert.equal(leaned!.payload.lean, 'reject')
})

test('a lean outside a pending proposal is dropped, invalid lean throws', () => {
  const g = createGame({ seed: 'lean2', playerCount: 5, talk: { preProposal: 1, postProposal: 0 } })
  const [req] = expectedDecisions(g)
  applyDecision(g, req.seat, { kind: 'discuss', say: 'hello', lean: 'approve' }) // no team yet
  const ev = g.log.filter((e) => e.type === 'utterance').at(-1)!
  assert.equal(ev.payload.lean, undefined)
  const [req2] = expectedDecisions(g)
  assert.throws(
    () => applyDecision(g, req2.seat, { kind: 'discuss', say: '', lean: 'maybe' as any }),
    /invalid lean/,
  )
})

test('discussion turns walk the table from the leader', () => {
  const g = createGame({ seed: 'talk', playerCount: 5, talk: { preProposal: 1, postProposal: 1 } })
  assert.equal(g.phase, 'discussion')
  const order: Seat[] = []
  for (let i = 0; i < 5; i++) {
    const [req] = expectedDecisions(g)
    assert.equal(req.kind, 'discuss')
    order.push(req.seat)
    applyDecision(g, req.seat, { kind: 'discuss', say: i % 2 ? 'hm' : '' })
  }
  assert.equal(order[0], g.leaderSeat)
  assert.equal(new Set(order).size, 5, 'everyone speaks exactly once')
  assert.equal(g.phase, 'proposal')
  propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 5])
  assert.equal(g.phase, 'discussion') // post-proposal talk round
  for (let i = 0; i < 5; i++) {
    const [req] = expectedDecisions(g)
    applyDecision(g, req.seat, { kind: 'discuss', say: '' })
  }
  assert.equal(g.phase, 'vote')
})
