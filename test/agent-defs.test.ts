// Agent library: built-in defs are valid, validation rejects junk, prompt
// layers reach the system prompt, and the engine-owned parts stay fixed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDefs, publicInfo, validateDef } from '../server/agents/defs.ts'
import { ROSTER } from '../server/llm/roster.ts'
import { buildMessages } from '../server/agents/prompts.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'

test('built-in library: one agent per roster model plus autopilot, all valid', () => {
  const defs = builtinDefs()
  assert.equal(defs.length, ROSTER.length + 1)
  for (const def of defs) validateDef(def)
  assert.ok(defs.some((d) => d.id === 'autopilot' && d.engine.type === 'heuristic'))
  const ids = defs.map((d) => d.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('publicInfo fills badges and maps engine to a display model', () => {
  const auto = publicInfo(builtinDefs().find((d) => d.id === 'autopilot')!)
  assert.equal(auto.model, 'rule-based')
  assert.equal(auto.monogram, 'AP')
  const custom = publicInfo(validateDef({
    id: 'chaos-goblin', name: 'Chaos Goblin',
    engine: { type: 'llm', model: 'deepseek', personality: 'be chaotic' },
  }))
  assert.equal(custom.monogram, 'CG')
  assert.ok(custom.color.length > 0)
  assert.equal(custom.personality, 'be chaotic')
})

test('validateDef rejects bad defs', () => {
  assert.throws(() => validateDef({ id: 'X BAD', name: 'x', engine: { type: 'heuristic' } }), /kebab/)
  assert.throws(() => validateDef({ id: 'ok', name: '', engine: { type: 'heuristic' } }), /name/)
  assert.throws(() => validateDef({ id: 'ok', name: 'x', engine: { type: 'llm', model: 'not-a-model' } }), /unknown roster/)
  assert.throws(() => validateDef({ id: 'ok', name: 'x', engine: { type: 'wat' } }), /engine/)
  assert.throws(() => validateDef({ id: 'ok', name: 'x', engine: { type: 'stdio', cmd: 5, args: [] } }), /stdio/)
})

test('personality and roleGuidance layer into the prompt; contracts stay fixed', () => {
  const g = createGame({ seed: 'defs-p', playerCount: 5, talk: { preProposal: 0, postProposal: 0 } })
  const view = viewFor(g, 0)
  const [plain] = buildMessages('vote', view, '')
  const [layered] = buildMessages('vote', view, '', {
    personality: 'You are theatrical and paranoid.',
    roleGuidance: { [view.role]: 'CUSTOM GUIDANCE LINE' },
  })
  assert.ok(!plain.content.includes('theatrical'))
  assert.ok(layered.content.includes('theatrical and paranoid'))
  assert.ok(layered.content.includes('CUSTOM GUIDANCE LINE'))
  // Engine-owned parts survive the overrides.
  for (const msg of [plain, layered]) {
    assert.match(msg.content, /"vote"/)               // output contract
    assert.match(msg.content, /TABLE TALK block/)     // injection guard
    assert.match(msg.content, /succeeding 3 of 5/)    // rules digest
  }
})
