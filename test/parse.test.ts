// Tolerant-parse behavior per decision kind: clean JSON, salvage shapes, and
// explicit parseFailed on garbage.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { parseDecision, legalityError } from '../server/agents/parse.ts'

const game = createGame({ seed: 'parse', playerCount: 7, talk: { preProposal: 0, postProposal: 0 } })
const view = viewFor(game, 0)

test('vote: clean JSON, word salvage, and failure', () => {
  const clean = parseDecision('vote', '{"thinking": "hmm", "vote": "reject"}', view)
  assert.equal(clean.parseFailed, false)
  assert.deepEqual(clean.decision, { kind: 'vote', vote: 'reject', thinking: 'hmm' })

  const prose = parseDecision('vote', 'I think I will approve this team.', view)
  assert.equal(prose.parseFailed, false)
  assert.equal((prose.decision as any).vote, 'approve')

  const garbage = parseDecision('vote', 'the weather is nice', view)
  assert.equal(garbage.parseFailed, true)
})

test('propose: clean, fenced-in-prose, number salvage, legality', () => {
  const clean = parseDecision('propose', '{"thinking":"x","team":[0,2],"pitch":"trust us"}', view)
  assert.equal(clean.parseFailed, false)
  assert.deepEqual((clean.decision as any).team, [0, 2])
  assert.equal((clean.decision as any).pitch, 'trust us')

  const fenced = parseDecision('propose', 'Sure! Here you go: {"team": [1, 3]} hope that helps', view)
  assert.equal(fenced.parseFailed, false)
  assert.deepEqual((fenced.decision as any).team, [1, 3])

  const salvaged = parseDecision('propose', 'I pick seats 4 and 6 for this quest.', view)
  assert.equal(salvaged.parseFailed, false)
  assert.deepEqual((salvaged.decision as any).team, [4, 6])

  const wrongSize = parseDecision('propose', '{"team":[0,1,2,3]}', view)
  assert.equal(wrongSize.parseFailed, false)
  assert.match(legalityError(wrongSize.decision!, view)!, /exactly 2/)

  const dupes = parseDecision('propose', '{"team":[1,1]}', view)
  assert.match(legalityError(dupes.decision!, view)!, /duplicate/)
})

test('quest and assassinate salvage', () => {
  assert.equal((parseDecision('quest', '{"card":"FAIL"}', view).decision as any).card, 'fail')
  assert.equal((parseDecision('quest', 'I will play success of course', view).decision as any).card, 'success')
  assert.equal(parseDecision('quest', 'hmm', view).parseFailed, true)

  const byName = parseDecision('assassinate', `It must be ${view.players[3].name}.`, view)
  assert.equal((byName.decision as any).target, 3)
  const byNumber = parseDecision('assassinate', 'seat 5 is merlin', view)
  assert.equal((byNumber.decision as any).target, 5)
  assert.equal(legalityError({ kind: 'assassinate', target: view.seat }, view) !== null, true)
})

test('discuss: prose is speech, JSON debris is not', () => {
  const clean = parseDecision('discuss', '{"thinking":"t","say":"I trust Gemini."}', view)
  assert.equal((clean.decision as any).say, 'I trust Gemini.')
  const pass = parseDecision('discuss', '{"say": ""}', view)
  assert.equal((pass.decision as any).say, '')
  const prose = parseDecision('discuss', 'No strong reads yet.', view)
  assert.equal((prose.decision as any).say, 'No strong reads yet.')
  const debris = parseDecision('discuss', '"say": [,', view)
  assert.equal(debris.parseFailed, true)
})

test('pitch: clean JSON, prose salvage, empty fails', () => {
  const clean = parseDecision('pitch', '{"thinking":"t","pitch":"Trust this pair."}', view)
  assert.equal(clean.parseFailed, false)
  assert.equal(clean.pitch, 'Trust this pair.')
  const prose = parseDecision('pitch', 'A solid team to start us off.', view)
  assert.equal(prose.pitch, 'A solid team to start us off.')
  assert.equal(parseDecision('pitch', '   ', view).parseFailed, true)
})

test('reflect: structured and raw scratchpads, empty fails', () => {
  const clean = parseDecision('reflect',
    '{"suspicions":[{"seat":2,"read":"votes with evil","confidence":70}],"plan":"watch seat 2"}', view)
  assert.equal(clean.parseFailed, false)
  assert.match(clean.scratchpad!, /seat 2: votes with evil \(70%\)/)
  assert.match(clean.scratchpad!, /Plan: watch seat 2/)

  const raw = parseDecision('reflect', 'Seat 2 seems evil. Stay close to seat 4.', view)
  assert.equal(raw.parseFailed, false)
  assert.ok(raw.scratchpad!.length > 0)

  assert.equal(parseDecision('reflect', '   ', view).parseFailed, true)
})

test('reflect: deductions render into the scratchpad as a bulleted section', () => {
  const withDeductions = parseDecision('reflect',
    '{"suspicions":[{"seat":2,"read":"loud","confidence":60}],' +
    '"deductions":["seat 3 excluded the players I trust, so seat 3 likely reads them as evil","  "],' +
    '"plan":"press seat 3"}', view)
  assert.equal(withDeductions.parseFailed, false)
  assert.match(withDeductions.scratchpad!, /Deductions:\n- seat 3 excluded the players I trust/)
  // Blank entries are dropped, not rendered as empty bullets.
  assert.doesNotMatch(withDeductions.scratchpad!, /- {2,}\n|^- $/m)

  // deductions alone (no suspicions/plan) is still a usable scratchpad.
  const only = parseDecision('reflect', '{"deductions":["a proven team was rejected without a reason"]}', view)
  assert.equal(only.parseFailed, false)
  assert.match(only.scratchpad!, /a proven team was rejected/)
})
