// Scripted-game tests for the rules that are easy to get wrong:
// strict-majority voting, the auto-approved hammer proposal, quest-card
// coercion, the double-fail quest, and the assassination phase.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDecision, createGame, expectedDecisions } from '../server/engine/game.ts'
import type { Game, Seat } from '../server/engine/types.ts'

function mk(playerCount = 7, seed = 'flow'): Game {
  // maxRounds 0: no discussion and no finalize — propose goes straight to vote.
  return createGame({ seed, playerCount, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
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

test('the 5th proposal is auto-approved with no vote, leader rotating after each rejection', () => {
  const g = mk(7, 'hammer')
  const leaders: Seat[] = []
  for (let i = 1; i <= 4; i++) {
    assert.equal(g.proposalNum, i)
    leaders.push(g.leaderSeat)
    propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 7])
    voteAll(g, () => 'reject')
  }
  for (let i = 1; i < leaders.length; i++) {
    assert.equal(leaders[i], (leaders[i - 1] + 1) % 7, 'leader rotates after each rejection')
  }

  // The hammer: with maxRounds 0 the 5th proposal goes straight to the quest —
  // no vote (the full-flow hammer path is covered in 'the hammer gets
  // discussion and finalize' below).
  assert.equal(g.proposalNum, 5)
  const team = [g.leaderSeat, (g.leaderSeat + 1) % 7].sort((a, b) => a - b)
  propose(g, team)
  assert.equal(g.phase, 'quest')
  assert.deepEqual(g.quests[0].team, team)
  assert.ok(expectedDecisions(g).every((r) => r.kind === 'quest'), 'only quest cards are owed')

  // The auto-approval is on the public record as a votes-free voteReveal.
  const auto = g.log.find((ev) => ev.type === 'voteReveal' && ev.payload.auto === true)
  assert.ok(auto, 'auto-approval emitted')
  assert.equal(auto!.visibility, 'public')
  assert.equal(auto!.payload.approved, true)
  assert.deepEqual(auto!.payload.votes, [])
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

// Drives one full discussion round; leanFor(seat) may return undefined (no lean).
function talkRound(g: Game, leanFor: (seat: Seat) => 'approve' | 'reject' | 'unsure' | undefined, sayFor: (seat: Seat) => string = () => ''): void {
  const n = g.discussion!.remaining.length
  for (let i = 0; i < n; i++) {
    const [req] = expectedDecisions(g)
    applyDecision(g, req.seat, { kind: 'discuss', say: sayFor(req.seat), lean: leanFor(req.seat) })
  }
}

test('lean settlement: a declaring round extends, a stable round settles into finalize', () => {
  const g = createGame({ seed: 'rounds', playerCount: 5, talk: { maxRounds: 3, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' } })
  propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 5])
  assert.equal(g.phase, 'discussion')

  // Round 1: leans appear — first declarations count as changes, so no settle.
  talkRound(g, () => 'approve')
  assert.equal(g.phase, 'discussion')
  assert.equal(g.discussion!.roundNum, 2)

  // Round 2: same leans repeated — settled, leader's finalize turn is next.
  talkRound(g, () => 'approve')
  assert.equal(g.phase, 'finalize')
  assert.deepEqual(expectedDecisions(g), [
    { kind: 'finalize', seat: g.leaderSeat, round: 1, proposalNum: 1 },
  ])
})

test('a lean flip keeps discussion alive until the cap', () => {
  const g = createGame({ seed: 'flip', playerCount: 5, talk: { maxRounds: 3, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' } })
  propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 5])
  talkRound(g, () => 'unsure')   // round 1: declarations (all "changes")
  talkRound(g, () => 'reject')   // round 2: everyone flips — still changing
  assert.equal(g.phase, 'discussion')
  assert.equal(g.discussion!.roundNum, 3, 'the flips earned round 3')
  talkRound(g, () => 'reject')   // round 3: stable, and the cap regardless
  assert.equal(g.phase, 'finalize')
})

test('a lean-less quiet round settles immediately (nobody objects — vote)', () => {
  const g = createGame({ seed: 'quiet', playerCount: 5, talk: { maxRounds: 3, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' } })
  propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 5])
  talkRound(g, () => undefined)
  assert.equal(g.phase, 'finalize')
})

test('the leader cannot lean; a non-leader lean-less utterance is legal; invalid lean throws', () => {
  const g = createGame({ seed: 'lean2', playerCount: 5, talk: { maxRounds: 2, maxRoundsAfterChange: 0, leaderInDiscussion: 'last' } })
  propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 5])
  // Non-leader without a lean: legal.
  const [req] = expectedDecisions(g)
  assert.notEqual(req.seat, g.leaderSeat)
  applyDecision(g, req.seat, { kind: 'discuss', say: 'hm' })
  assert.equal(g.log.filter((e) => e.type === 'utterance').at(-1)!.payload.lean, undefined)
  // Invalid lean value: throws.
  const [req2] = expectedDecisions(g)
  assert.throws(
    () => applyDecision(g, req2.seat, { kind: 'discuss', say: '', lean: 'maybe' as any }),
    /invalid lean/,
  )
  // Walk to the leader's turn (last in the round) — their lean is dropped.
  while (expectedDecisions(g)[0].seat !== g.leaderSeat) {
    const [r] = expectedDecisions(g)
    applyDecision(g, r.seat, { kind: 'discuss', say: '' })
  }
  applyDecision(g, g.leaderSeat, { kind: 'discuss', say: 'trust me', lean: 'approve' })
  const leaderUtt = g.log.filter((e) => e.type === 'utterance').at(-1)!
  assert.equal(leaderUtt.payload.seat, g.leaderSeat)
  assert.equal(leaderUtt.payload.lean, undefined, 'leader lean dropped at the chokepoint')
})

test('discussion walks non-leaders from the leader\'s left, leader speaks last', () => {
  const g = createGame({ seed: 'talk', playerCount: 5, talk: { maxRounds: 1, maxRoundsAfterChange: 0, leaderInDiscussion: 'last' } })
  assert.equal(g.phase, 'proposal', 'the crown opens with a proposal, no pre-talk')
  propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 5])
  assert.equal(g.phase, 'discussion')
  const order: Seat[] = []
  for (let i = 0; i < 5; i++) {
    const [req] = expectedDecisions(g)
    assert.equal(req.kind, 'discuss')
    order.push(req.seat)
    applyDecision(g, req.seat, { kind: 'discuss', say: i % 2 ? 'hm' : '' })
  }
  assert.equal(order[0], (g.leaderSeat + 1) % 5, 'starts left of the leader')
  assert.equal(order.at(-1), g.leaderSeat, 'leader closes the round')
  assert.equal(new Set(order).size, 5, 'everyone speaks exactly once')
  assert.equal(g.phase, 'finalize')
})

test('leaderInDiscussion none excludes the leader from the rotation', () => {
  const g = createGame({ seed: 'noleader', playerCount: 5, talk: { maxRounds: 1, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' } })
  propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 5])
  const order: Seat[] = []
  for (let i = 0; i < 4; i++) {
    const [req] = expectedDecisions(g)
    order.push(req.seat)
    applyDecision(g, req.seat, { kind: 'discuss', say: '' })
  }
  assert.ok(!order.includes(g.leaderSeat))
  assert.equal(g.phase, 'finalize')
})

test('finalize stick: proposalLocked, then the vote on the unchanged team', () => {
  const g = createGame({ seed: 'stick', playerCount: 5, talk: { maxRounds: 1, maxRoundsAfterChange: 2, leaderInDiscussion: 'none' } })
  const team = [g.leaderSeat, (g.leaderSeat + 1) % 5].sort((a, b) => a - b)
  propose(g, team)
  talkRound(g, () => undefined)
  assert.equal(g.phase, 'finalize')
  applyDecision(g, g.leaderSeat, { kind: 'finalize', stick: true })
  const locked = g.log.at(-1)!
  assert.equal(locked.type, 'proposalLocked')
  assert.equal(locked.visibility, 'public')
  assert.deepEqual(locked.payload.team, team)
  assert.equal(g.phase, 'vote')
  assert.deepEqual(g.currentTeam, team)
})

test('finalize revise: new team, lean reset, one post-revision round, no second finalize', () => {
  const g = createGame({ seed: 'revise', playerCount: 5, talk: { maxRounds: 1, maxRoundsAfterChange: 1, leaderInDiscussion: 'none' } })
  const leader = g.leaderSeat
  const from = [leader, (leader + 1) % 5].sort((a, b) => a - b)
  propose(g, from)
  talkRound(g, () => 'reject')
  assert.equal(g.phase, 'finalize')

  // Identical "revision" is rejected.
  assert.throws(
    () => applyDecision(g, leader, { kind: 'finalize', stick: false, team: from }),
    /identical/,
  )

  const to = [leader, (leader + 2) % 5].sort((a, b) => a - b)
  applyDecision(g, leader, { kind: 'finalize', stick: false, team: to, reason: 'fine, swapping.' })
  const revised = g.log.filter((e) => e.type === 'proposalRevised').at(-1)!
  assert.deepEqual(revised.payload.from, from)
  assert.deepEqual(revised.payload.to, to)
  assert.equal(revised.payload.reason, 'fine, swapping.')
  assert.deepEqual(g.currentTeam, to)

  // Post-revision segment: fresh leans, roundNum restarts, postRevision set.
  assert.equal(g.phase, 'discussion')
  assert.equal(g.discussion!.roundNum, 1)
  assert.equal(g.discussion!.postRevision, true)
  assert.deepEqual(g.discussion!.leans, {})

  // One round (the cap), then straight to vote — no second finalize.
  talkRound(g, () => 'approve')
  assert.equal(g.phase, 'vote')

  // The record shows ONE proposal with the final team and the revision preserved.
  voteAll(g, () => 'approve')
  const utt = g.log.filter((e) => e.type === 'utterance' && e.payload.postRevision === true)
  assert.equal(utt.length, 4, 'post-revision utterances are marked')
  assert.equal(g.phase, 'quest')
  assert.deepEqual(g.quests[0].team, to)
})

test('maxRoundsAfterChange 0: a revision goes straight to the vote', () => {
  const g = createGame({ seed: 'revise0', playerCount: 5, talk: { maxRounds: 1, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' } })
  const leader = g.leaderSeat
  propose(g, [leader, (leader + 1) % 5])
  talkRound(g, () => undefined)
  const to = [leader, (leader + 2) % 5].sort((a, b) => a - b)
  applyDecision(g, leader, { kind: 'finalize', stick: false, team: to })
  assert.equal(g.phase, 'vote')
  assert.deepEqual(g.currentTeam, to)
})

test('the hammer gets discussion and finalize, then skips only the vote', () => {
  const g = createGame({ seed: 'hammer-talk', playerCount: 5, talk: { maxRounds: 1, maxRoundsAfterChange: 1, leaderInDiscussion: 'none' } })
  for (let i = 1; i <= 4; i++) {
    propose(g, [g.leaderSeat, (g.leaderSeat + 1) % 5])
    talkRound(g, () => undefined)
    applyDecision(g, g.leaderSeat, { kind: 'finalize', stick: true })
    voteAll(g, () => 'reject')
  }
  assert.equal(g.proposalNum, 5)
  const leader = g.leaderSeat
  const team = [leader, (leader + 1) % 5].sort((a, b) => a - b)
  propose(g, team)
  assert.equal(g.phase, 'discussion', 'the hammer still gets discussed')
  talkRound(g, () => 'reject')
  assert.equal(g.phase, 'finalize', 'the hammer leader still gets the revision turn')
  const to = [leader, (leader + 2) % 5].sort((a, b) => a - b)
  applyDecision(g, leader, { kind: 'finalize', stick: false, team: to, reason: 'heard you.' })
  talkRound(g, () => undefined)
  // Post-revision talk done: auto-approved voteReveal, straight to quest.
  assert.equal(g.phase, 'quest')
  const auto = g.log.find((ev) => ev.type === 'voteReveal' && ev.payload.auto === true)!
  assert.deepEqual(auto.payload.team, to)
  assert.deepEqual(g.quests[0].team, to)
})

test('a public leadChange marks the leader at the start of every proposal cycle', () => {
  const g = mk(7, 'leadmarker')
  const leadChanges = () => g.log.filter((e) => e.type === 'leadChange')

  // The initial deal announces the first leader.
  let marks = leadChanges()
  assert.equal(marks.length, 1)
  assert.equal(marks[0].visibility, 'public')
  assert.deepEqual(marks[0].payload, { seat: g.leaderSeat, round: 1, proposalNum: 1 })

  // A rejection opens a fresh cycle under the rotated leader — new marker.
  const firstLeader = g.leaderSeat
  propose(g, [0, 1])
  voteAll(g, () => 'reject')
  marks = leadChanges()
  assert.equal(marks.length, 2)
  assert.deepEqual(marks[1].payload, { seat: (firstLeader + 1) % 7, round: 1, proposalNum: 2 })

  // A completed quest advances the round under the next leader — new marker.
  const before = leadChanges().length
  runRound(g, [g.leaderSeat, (g.leaderSeat + 1) % 7], [])
  const latest = leadChanges().at(-1)!
  assert.equal(leadChanges().length, before + 1)
  assert.equal(latest.payload.round, 2)
  assert.equal(latest.payload.proposalNum, 1)
  assert.equal(latest.payload.seat, g.leaderSeat)
})
