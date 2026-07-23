// Mid-game renames: public event, live re-labeling, dedupe guard, and the
// transcript notice bots learn the mapping from.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDecision, createGame, expectedDecisions, renamePlayer } from '../server/engine/game.ts'
import { viewFor, viewForSpectator } from '../server/engine/view.ts'
import { transcriptText } from '../server/agents/prompts.ts'

test('rename updates the player, emits a public event, and re-labels history', () => {
  const g = createGame({ seed: 'rn', playerCount: 5, talk: { preProposal: 1, postProposal: 0 } })
  const [req] = expectedDecisions(g)
  applyDecision(g, req.seat, { kind: 'discuss', say: 'hello table' })

  const speaker = req.seat
  renamePlayer(g, speaker, 'Al')
  assert.equal(g.players[speaker].name, 'Al')
  assert.equal(g.config.names[speaker], 'Al')

  const ev = g.log.at(-1)!
  assert.equal(ev.type, 'rename')
  assert.equal(ev.visibility, 'public')
  assert.equal(ev.payload.to, 'Al')

  // History re-labels live: the earlier utterance is now attributed to Al,
  // and the transcript carries the change notice for bots.
  const view = viewFor(g, (speaker + 1) % 5)
  const talk = view.transcript
  assert.equal(talk[0].name, 'Al')
  assert.match(talk.at(-1)!.text, /changed display name from .* to Al/)
  assert.match(transcriptText(view), /changed display name/)

  // Spectators see it too.
  assert.ok(viewForSpectator(g).events.some((e) => e.type === 'rename'))
})

test('rename rejects empty and already-taken names', () => {
  const g = createGame({ seed: 'rn2', playerCount: 5 })
  assert.throws(() => renamePlayer(g, 0, '   '), /empty/)
  assert.throws(() => renamePlayer(g, 0, 'You'), /reserved/)
  assert.throws(() => renamePlayer(g, 0, g.players[1].name.toUpperCase()), /already taken/)
  renamePlayer(g, 0, g.players[0].name) // no-op rename is fine
  assert.notEqual(g.log.at(-1)!.type, 'rename')
})
