// Player names are injected verbatim into other players' LLM prompts, so the
// engine rejects pronoun/game-term names and scrubs spoken seat references.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameIsReserved, stripSeatRefs } from '../server/engine/rules.ts'
import { applyDecision, createGame, expectedDecisions } from '../server/engine/game.ts'
import type { Player } from '../server/engine/types.ts'

test('nameIsReserved catches pronouns and game terms, case/space-insensitively', () => {
  for (const bad of ['You', 'you', ' ME ', 'i', 'Myself', 'us', 'Leader', 'SYSTEM', 'assistant']) {
    assert.equal(nameIsReserved(bad), true, `${bad} should be reserved`)
  }
  for (const ok of ['Allen', 'Gemini', 'Human', 'Ursula', 'Mimi', 'Wesley', 'Iris']) {
    assert.equal(nameIsReserved(ok), false, `${ok} should be allowed`)
  }
})

test('stripSeatRefs rewrites seat/player references to names, leaving other numbers', () => {
  const players = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve'].map(
    (name, seat) => ({ seat, name } as Player),
  )
  assert.equal(stripSeatRefs('watch seat 2 and player 4', players), 'watch Cara and Eve')
  assert.equal(stripSeatRefs('Seat #0 is quiet', players), 'Alice is quiet')
  // A keyword-less number, or one out of range, is left untouched.
  assert.equal(stripSeatRefs('quest 3 needs 2 fails', players), 'quest 3 needs 2 fails')
  assert.equal(stripSeatRefs('seat 9 does not exist', players), 'seat 9 does not exist')
})

test('discussion utterances have their seat references scrubbed as they enter the log', () => {
  const names = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve']
  const g = createGame({ seed: 'np', playerCount: 5, names, talk: { preProposal: 1, postProposal: 0 } })
  const [req] = expectedDecisions(g)
  applyDecision(g, req.seat, { kind: 'discuss', say: 'I trust seat 2, not player 3' })
  const utter = g.log.find((e) => e.type === 'utterance')!
  assert.equal(utter.payload.text, 'I trust Cara, not Dan')
})
