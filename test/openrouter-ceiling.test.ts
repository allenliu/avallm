// Contract test: the spend ceiling is enforced at the dispatch chokepoint
// (issue), so EVERY outbound call is gated — including the blank-under-json
// retry, which used to bypass the one-shot check in call() and could bill a
// second time past the cap.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOpenRouter, SpendCeilingError } from '../server/llm/openrouter.ts'

const realFetch = globalThis.fetch

function mockFetch(body: unknown): number & { calls: number } {
  const state = { calls: 0 }
  globalThis.fetch = (async () => {
    state.calls++
    return {
      ok: true,
      status: 200,
      async json() { return body },
      async text() { return '' },
    } as unknown as Response
  }) as typeof fetch
  return state as unknown as number & { calls: number }
}

test('the blank-under-json retry is refused once the cap is crossed', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key'
  process.env.OPENROUTER_MAX_SPEND_USD = '0.01'
  try {
    // First HTTP call reports a cost that blows the cap AND returns blank
    // content under response_format, which triggers call()'s retry.
    const state = mockFetch({
      provider: 'test',
      usage: { cost: 5.0, prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ message: { content: '' } }],
    })
    const client = createOpenRouter({ quiet: true })
    await assert.rejects(
      client.call('some/model', [{ role: 'user', content: 'hi' }], {
        tag: 't', response_format: { type: 'json_object' },
      }),
      (e: unknown) => e instanceof SpendCeilingError,
    )
    // Exactly one HTTP call: the retry never left the process.
    assert.equal(state.calls, 1)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a fresh client under the same cap still makes its first call', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key'
  process.env.OPENROUTER_MAX_SPEND_USD = '0.01'
  try {
    const state = mockFetch({
      provider: 'test',
      usage: { cost: 0.001, prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ message: { content: '{"vote":"approve"}' } }],
    })
    const client = createOpenRouter({ quiet: true })
    const out = await client.call('m', [{ role: 'user', content: 'x' }], { tag: 't' })
    assert.equal(state.calls, 1)
    assert.equal(out, '{"vote":"approve"}')
    assert.ok(client.getTotalCost() > 0)
  } finally {
    globalThis.fetch = realFetch
  }
})
