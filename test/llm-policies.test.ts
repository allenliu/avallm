// Contract tests: the roster only names models the policy tables know, and
// the measured suppression flags survive the port from datingsim.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROSTER, DEFAULT_TABLE, rosterById } from '../server/llm/roster.ts'
import { policyFor, suppressionFor } from '../server/llm/reasoning-policy.ts'
import { providerPrefsFor, providerServedOutsidePolicy } from '../server/llm/provider-policy.ts'
import { CALL_PARAMS } from '../server/llm/call-params.ts'

test('roster ids are unique and default table resolves', () => {
  const ids = ROSTER.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of DEFAULT_TABLE) rosterById(id)
  assert.ok(DEFAULT_TABLE.length >= 4)
})

test('every roster slug has a known reasoning-policy family', () => {
  for (const r of ROSTER) {
    const p = policyFor(r.slug)
    assert.notEqual(p.family, 'unknown', `${r.slug} needs a reasoning-policy entry`)
    assert.ok(p.canSuppress, `${r.slug} cannot be suppression-controlled — wrong model for this roster`)
  }
})

test('measured suppression flags survive the port', () => {
  assert.deepEqual(suppressionFor('deepseek/deepseek-v4-flash').value, { effort: 'none' })
  assert.deepEqual(suppressionFor('moonshotai/kimi-k2.5').value, { effort: 'none' })
  assert.equal(suppressionFor('google/gemini-3.1-flash-lite').value, null) // suppress by omission
  assert.deepEqual(suppressionFor('openai/gpt-oss-120b').value, { effort: 'low' })
  assert.equal(suppressionFor('google/gemini-3.1-pro-preview').canSuppress, false)
  assert.equal(suppressionFor('anthropic/claude-haiku-4.5').value, null)
})

test('provider policy: glm-5.2 pinned, everything else unconstrained', () => {
  assert.ok(providerPrefsFor('z-ai/glm-5.2')?.order?.includes('Novita'))
  assert.equal(providerPrefsFor('z-ai/glm-4.6'), null)
  assert.equal(providerPrefsFor('deepseek/deepseek-v4-flash'), null)
  assert.ok(providerServedOutsidePolicy(
    { order: ['Novita'], allow_fallbacks: false }, 'SomeoneElse',
  ))
  assert.ok(!providerServedOutsidePolicy({ order: ['Novita'] }, 'SomeoneElse')) // soft pref
})

test('call params cover every kind with json mode', () => {
  for (const kind of ['discuss', 'propose', 'vote', 'quest', 'assassinate', 'reflect'] as const) {
    const p = CALL_PARAMS[kind]
    assert.ok(p.max_tokens >= 100 && p.max_tokens <= 500, kind)
    assert.ok(p.temperature >= 0 && p.temperature <= 1, kind)
    assert.equal(p.json, true, kind)
  }
})
