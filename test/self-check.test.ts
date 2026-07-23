// Experiment 3: the second-order self-check norm. Before speaking, a bot must
// consider what its words reveal about its own secret role (ReCon import).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { buildMessages, TABLE_TALK_NORMS } from '../server/agents/prompts.ts'

test('TABLE_TALK_NORMS carries the second-order self-check', () => {
  assert.match(TABLE_TALK_NORMS, /second-order check/)
  assert.match(TABLE_TALK_NORMS, /what your words reveal about your own secret role/)
  assert.match(TABLE_TALK_NORMS, /Never state or imply something only your role would know/)
})

test('discuss and pitch system prompts include the self-check bullet', () => {
  const g = createGame({ seed: 'selfcheck', playerCount: 5, talk: { preProposal: 1, postProposal: 0 } })
  const view = viewFor(g, 0)

  const [discussSys] = buildMessages('discuss', view, '', {})
  assert.equal(discussSys.role, 'system')
  assert.match(discussSys.content, /run a second-order check/)
  assert.match(discussSys.content, /what your words reveal about your own secret role/)

  const [pitchSys] = buildMessages('pitch', view, '', {})
  assert.match(pitchSys.content, /run a second-order check/)

  // Non-speech kinds do not carry the table-talk norms.
  const [voteSys] = buildMessages('vote', view, '', {})
  assert.ok(!voteSys.content.includes('second-order check'))
})
