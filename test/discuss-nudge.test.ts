// Experiment 4: the discuss ask no longer teaches passivity ("most players
// pass by round 2"); it rebalances toward speaking when the bot has something
// real, while still allowing a genuine pass.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { buildMessages } from '../server/agents/prompts.ts'

test('discuss nudge drops the round-2 passivity clause and rebalances toward speaking', () => {
  const g = createGame({ seed: 'nudge', playerCount: 5, talk: { preProposal: 1, postProposal: 0 } })
  const view = viewFor(g, 0)
  // Exercise the round>1 branch that previously appended the passivity clause.
  view.discussionRound = 2
  const [, user] = buildMessages('discuss', view, '', {})

  // The old passivity teaching is gone.
  assert.ok(
    !user.content.includes('most players pass by round 2'),
    'the "most players pass by round 2" clause must be removed',
  )

  // The rebalanced guidance is present: speak on a real signal, pass genuinely.
  assert.match(user.content, /Speak when you have something real to add/)
  assert.match(user.content, /a fresh read, a contradiction to point out, or a result or vote that implicates you/)
  assert.match(user.content, /Pass when you genuinely have nothing to add and nothing is aimed at you\./)
})
