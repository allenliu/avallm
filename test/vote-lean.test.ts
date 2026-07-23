// Vote-lean coherence: the vote prompt surfaces the deciding seat's OWN most
// recent public lean on the team currently on the table, so a vote can't
// silently contradict a lean the table already saw.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { buildMessages } from '../server/agents/prompts.ts'

// Drive a 5p game to a vote with a team on the table.
function gameAtVote() {
  const g = createGame({ seed: 'vl', playerCount: 5, talk: { preProposal: 0, postProposal: 0 } })
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [0, 1] })
  assert.equal(g.phase, 'vote')
  return g
}

test('vote prompt surfaces the deciding seat own recent lean', () => {
  const g = gameAtVote()
  const voterSeat = 2
  const view = viewFor(g, voterSeat)
  // The deciding seat leaned approve on the current team during table talk.
  view.transcript = [
    ...view.transcript,
    { seat: (voterSeat + 1) % 5, name: g.players[(voterSeat + 1) % 5].name, text: 'Looks shaky.', lean: 'reject' },
    { seat: voterSeat, name: g.players[voterSeat].name, text: 'I am fine with this pair.', lean: 'approve' },
  ]
  const [, user] = buildMessages('vote', view, '', {})
  assert.match(user.content, /Your most recent public lean on this team was: approve/)
})

test('vote prompt picks the latest own lean and ignores other seats', () => {
  const g = gameAtVote()
  const voterSeat = 2
  const view = viewFor(g, voterSeat)
  view.transcript = [
    ...view.transcript,
    { seat: voterSeat, name: g.players[voterSeat].name, text: 'Not sure yet.', lean: 'unsure' },
    { seat: (voterSeat + 1) % 5, name: g.players[(voterSeat + 1) % 5].name, text: 'I like it.', lean: 'approve' },
    { seat: voterSeat, name: g.players[voterSeat].name, text: 'Now I want to reject.', lean: 'reject' },
  ]
  const [, user] = buildMessages('vote', view, '', {})
  assert.match(user.content, /Your most recent public lean on this team was: reject/)
})

test('vote prompt omits the lean callout when the seat never leaned', () => {
  const g = gameAtVote()
  const view = viewFor(g, 2)
  const [, user] = buildMessages('vote', view, '', {})
  assert.ok(!user.content.includes('most recent public lean'), 'no callout without a prior lean')
  assert.match(user.content, /Vote on the proposed team: approve or reject\./)
})
