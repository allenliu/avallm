// Agent library: built-in defs are valid, validation rejects junk, prompt
// layers reach the system prompt, and the engine-owned parts stay fixed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDefs, parseTableSeat, publicInfo, resolveModel, validateDef } from '../server/agents/defs.ts'
import { DEFAULT_MODEL, ROSTER, rosterById } from '../server/llm/roster.ts'
import { buildMessages, ROLE_GUIDANCE } from '../server/agents/prompts.ts'
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
  assert.throws(() => validateDef({ id: 'ok', name: 'x', engine: { type: 'llm', roleGuidance: { wizard: 'x' } } }), /unknown role/)
  assert.throws(() => validateDef({ id: 'ok', name: 'x', engine: { type: 'llm', roleGuidanceMode: 'merge' } }), /roleGuidanceMode/)
})

test('llm model is optional — a personality-only agent validates and rides the default', () => {
  const def = validateDef({
    id: 'grumpy-percival', name: 'Grumpy Percival',
    engine: { type: 'llm', personality: 'suspicious of everyone' },
  })
  assert.equal(def.engine.type === 'llm' && def.engine.model, undefined)
  // publicInfo shows the resolved slug, never "unset".
  assert.equal(publicInfo(def).model, rosterById(DEFAULT_MODEL).slug)
})

test('resolveModel precedence: seat override > def suggestion > DEFAULT_MODEL', () => {
  const withModel = validateDef({ id: 'aa', name: 'A', engine: { type: 'llm', model: 'haiku' } })
  const noModel = validateDef({ id: 'bb', name: 'B', engine: { type: 'llm', personality: 'x' } })
  assert.equal(resolveModel(noModel), DEFAULT_MODEL)         // fallback
  assert.equal(resolveModel(withModel), 'haiku')             // def suggestion
  assert.equal(resolveModel(withModel, 'gemini'), 'gemini')  // seat override wins
  assert.equal(resolveModel(noModel, 'kimi'), 'kimi')
  // The override also drives the transparency badge.
  assert.equal(publicInfo(withModel, 'gemini').model, rosterById('gemini').slug)
})

test('parseTableSeat accepts both wire shapes and rejects bad overrides', () => {
  const lib = builtinDefs()
  const byId = (id: string) => {
    const d = lib.find((x) => x.id === id)
    if (!d) throw new Error(`unknown agent: ${id}`)
    return d
  }
  assert.deepEqual(parseTableSeat('haiku', byId), { agent: 'haiku' })           // legacy bare id
  assert.deepEqual(parseTableSeat({ agent: 'haiku', model: 'gemini' }, byId), { agent: 'haiku', model: 'gemini' })
  assert.throws(() => parseTableSeat('nope', byId), /unknown agent/)
  assert.throws(() => parseTableSeat({ agent: 'haiku', model: 'nope' }, byId), /unknown roster/)
  // A model override on a non-llm engine is a create-time error, not a start-time surprise.
  assert.throws(() => parseTableSeat({ agent: 'autopilot', model: 'haiku' }, byId), /does not take a model/)
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
  // 'replace' (default) drops the baseline guidance for that role; 'append'
  // keeps it, so the agent still rides baseline strategy improvements.
  const baseGuidance = ROLE_GUIDANCE[view.role]
  const [replaced] = buildMessages('vote', view, '', { roleGuidance: { [view.role]: 'ONLY MINE' } })
  const [appended] = buildMessages('vote', view, '', { roleGuidance: { [view.role]: 'ALSO MINE' }, roleGuidanceMode: 'append' })
  assert.ok(!replaced.content.includes(baseGuidance) && replaced.content.includes('ONLY MINE'))
  assert.ok(appended.content.includes(baseGuidance) && appended.content.includes('ALSO MINE'))
  // Engine-owned parts survive the overrides.
  for (const msg of [plain, layered]) {
    assert.match(msg.content, /"vote"/)               // output contract
    assert.match(msg.content, /TABLE TALK block/)     // injection guard
    assert.match(msg.content, /succeeding 3 of 5/)    // rules digest
  }
})
