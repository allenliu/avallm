// The LLM agent's ladder and scratchpad, with a fake transport — no API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { createLlmAgent } from '../server/agents/llm.ts'
import { createHeuristicAgent } from '../server/agents/heuristic.ts'
import { runGame } from '../server/sim/runner.ts'
import type { Msg, OpenRouterClient, CallOpts } from '../server/llm/openrouter.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import type { Seat } from '../server/engine/types.ts'

function fakeClient(handler: (opts: CallOpts, messages: Msg[]) => string): OpenRouterClient & { calls: CallOpts[] } {
  const calls: CallOpts[] = []
  return {
    calls,
    async call(_model, messages, opts = {}) {
      calls.push(opts)
      return handler(opts, messages)
    },
    getSpend: () => ({}),
    getTotalCost: () => 0,
  }
}

const game = createGame({ seed: 'llm-t', playerCount: 5, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
const view0 = viewFor(game, 0)

test('clean decision carries thinking into the Decision', async () => {
  const client = fakeClient(() => '{"thinking": "seat 2 is loud", "vote": "approve"}')
  const agent = createLlmAgent({ modelId: 'deepseek', client })
  const d = await agent.decide({ kind: 'vote', seat: 0, round: 1, proposalNum: 1 }, view0)
  assert.deepEqual(d, { kind: 'vote', vote: 'approve', thinking: 'seat 2 is loud' })
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].tag, 'deepseek/vote')
})

test('good quest cards skip the LLM call entirely; evil still decides', async () => {
  const client = fakeClient(() => '{"thinking": "one fail is enough", "card": "fail"}')
  const good = game.players.find((p) => p.alignment === 'good')!
  const goodAgent = createLlmAgent({ modelId: 'deepseek', client })
  const d = await goodAgent.decide(
    { kind: 'quest', seat: good.seat, round: 1, proposalNum: 1 }, viewFor(game, good.seat),
  )
  assert.deepEqual(d, { kind: 'quest', card: 'success' })
  assert.equal(client.calls.length, 0, 'a forced decision must not burn a call')

  const evil = game.players.find((p) => p.alignment === 'evil')!
  const evilAgent = createLlmAgent({ modelId: 'deepseek', client })
  const d2 = await evilAgent.decide(
    { kind: 'quest', seat: evil.seat, round: 1, proposalNum: 1 }, viewFor(game, evil.seat),
  )
  assert.equal((d2 as any).card, 'fail')
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].tag, 'deepseek/quest')
})

test('one malformed reply triggers exactly one correction retry', async () => {
  let n = 0
  const client = fakeClient((_opts, messages) => {
    n++
    if (n === 1) return 'I like this team a lot!!'
    // The retry must carry the correction context.
    assert.ok(messages.some((m) => m.role === 'user' && /not usable/.test(m.content)))
    return '{"vote": "reject"}'
  })
  const agent = createLlmAgent({ modelId: 'gemini', client })
  const d = await agent.decide({ kind: 'vote', seat: 0, round: 1, proposalNum: 1 }, view0)
  assert.equal((d as any).vote, 'reject')
  assert.equal(n, 2)
})

test('propose is commit-then-explain: pitch generated with the team locked', async () => {
  const client = fakeClient((opts, messages) => {
    if (opts.tag?.endsWith('/propose')) return '{"thinking": "clean pair", "team": [0, 2]}'
    if (opts.tag?.endsWith('/pitch')) {
      // The pitch prompt must carry the chosen team, by name.
      const user = messages.find((m) => m.role === 'user')!
      assert.match(user.content, /your proposed team for quest/)
      assert.ok(user.content.includes(view0.players[0].name))
      assert.ok(user.content.includes(view0.players[2].name))
      return '{"thinking": "sell it", "pitch": "Clean start with a proven pair."}'
    }
    throw new Error(`unexpected call ${opts.tag}`)
  })
  const agent = createLlmAgent({ modelId: 'deepseek', client })
  const d = await agent.decide({ kind: 'propose', seat: 0, round: 1, proposalNum: 1 }, view0)
  assert.deepEqual((d as any).team, [0, 2])
  assert.equal((d as any).pitch, 'Clean start with a proven pair.')
  assert.equal(client.calls.length, 2)
})

test('a failed pitch call still yields a (silent) proposal', async () => {
  const client = fakeClient((opts) => {
    if (opts.tag?.endsWith('/propose')) return '{"team": [0, 1]}'
    throw new Error('pitch model exploded')
  })
  const agent = createLlmAgent({ modelId: 'gemini', client })
  const d = await agent.decide({ kind: 'propose', seat: 0, round: 1, proposalNum: 1 }, view0)
  assert.deepEqual((d as any).team, [0, 1])
  assert.equal((d as any).pitch, undefined)
})

test('two failures throw (the runner then degrades to heuristic)', async () => {
  const client = fakeClient(() => 'zzz')
  const agent = createLlmAgent({ modelId: 'kimi', client })
  await assert.rejects(
    agent.decide({ kind: 'vote', seat: 0, round: 1, proposalNum: 1 }, view0),
    /failed vote twice/,
  )
})

test('an always-broken llm agent degrades but the game completes', async () => {
  const seed = 'llm-degrade'
  const g = createGame({ seed, playerCount: 5, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
  const broken = createLlmAgent({ modelId: 'glm', client: fakeClient(() => '???') })
  const agents = new Map<Seat, AvalonAgent>(
    g.players.map((p) => [
      p.seat,
      p.seat === 1 ? broken : createHeuristicAgent({ seed, seat: p.seat }),
    ]),
  )
  const result = await runGame({ game: g, agents })
  assert.equal(result.game.phase, 'gameOver')
  assert.ok(result.degraded.length > 0)
  assert.ok(result.degraded.every((d) => d.seat === 1))
})

test('reflect fires after a quest resolves and feeds the next prompt', async () => {
  const seed = 'llm-reflect'
  const g = createGame({ seed, playerCount: 5, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
  let sawScratchpadInPrompt = false
  const client = fakeClient((opts, messages) => {
    if (opts.tag?.endsWith('/reflect')) {
      return '{"suspicions":[{"seat":3,"read":"failed the quest","confidence":80}],"plan":"reject seat 3"}'
    }
    if (messages.some((m) => m.content.includes('failed the quest (80%)'))) {
      sawScratchpadInPrompt = true
    }
    if (opts.tag?.endsWith('/vote')) return '{"vote":"approve"}'
    if (opts.tag?.endsWith('/quest')) return '{"card":"success"}'
    if (opts.tag?.endsWith('/propose')) return '{"team":[0,1]}'
    return '{"say":""}'
  })
  const agent = createLlmAgent({ modelId: 'kimi', client })

  // Round 1: propose+approve a team, resolve the quest with the llm agent on it.
  const { applyDecision } = await import('../server/engine/game.ts')
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [0, 1] })
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
  for (const s of [0, 1]) applyDecision(g, s, { kind: 'quest', card: 'success' })

  // Quest 1 resolved; the agent's next decision should reflect first.
  const d = await agent.decide({ kind: 'vote', seat: 0, round: 2, proposalNum: 1 }, viewFor(g, 0))
  assert.equal((d as any).kind, 'vote')
  const tags = client.calls.map((c) => c.tag)
  assert.ok(tags.includes('kimi/reflect'), `expected a reflect call, got ${tags}`)
  assert.ok(sawScratchpadInPrompt, 'reflect output should appear in the following prompt')

  // The refreshed pad rides the post-reflect decision so the engine can log
  // it; a second decision without a new reflect carries no notes.
  assert.match((d as any).notes, /failed the quest \(80%\)/)
  const d2 = await agent.decide({ kind: 'vote', seat: 0, round: 2, proposalNum: 1 }, viewFor(g, 0))
  assert.equal((d2 as any).notes, undefined)

  // Engine side: a decision carrying notes lands as a seat-private
  // scratchpad event when applied.
  applyDecision(g, g.leaderSeat, {
    kind: 'propose', team: [0, 1, 2], notes: 'seat 3: failed the quest (80%)',
  })
  const ev = g.log.find((e) => e.type === 'scratchpad')!
  assert.ok(ev)
  assert.deepEqual(ev.visibility, { only: [g.leaderSeat] })
  assert.match(ev.payload.text as string, /failed the quest/)
})

test('reflect fires after a proposal is REJECTED, before any quest resolves', async () => {
  const g = createGame({ seed: 'llm-vote-reflect', playerCount: 5, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
  const client = fakeClient((opts) => {
    if (opts.tag?.endsWith('/reflect')) return '{"suspicions":[{"seat":2,"read":"rejected a clean team","confidence":40}],"plan":"watch seat 2"}'
    if (opts.tag?.endsWith('/vote')) return '{"vote":"reject"}'
    if (opts.tag?.endsWith('/propose')) return '{"team":[0,1]}'
    return '{"say":""}'
  })
  const agent = createLlmAgent({ modelId: 'kimi', client })

  const { applyDecision } = await import('../server/engine/game.ts')
  // Round 1, proposal 1: propose then reject it. No quest has resolved, but a
  // rejection is public social evidence — the evidence cadence reflects on it.
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [0, 1] })
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'reject' })
  assert.ok(g.quests.every((q) => q.result === undefined), 'no quest should have resolved yet')

  await agent.decide({ kind: 'vote', seat: 0, round: 1, proposalNum: 2 }, viewFor(g, 0))
  assert.ok(client.calls.map((c) => c.tag).includes('kimi/reflect'), 'a rejection should trigger a reflect')
})

test('an APPROVED vote reveal alone does not trigger a reflect', async () => {
  const g = createGame({ seed: 'llm-vote-reflect', playerCount: 5, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
  const client = fakeClient((opts) => {
    if (opts.tag?.endsWith('/reflect')) return '{"suspicions":[],"plan":"x"}'
    if (opts.tag?.endsWith('/vote')) return '{"vote":"approve"}'
    if (opts.tag?.endsWith('/propose')) return '{"team":[0,1]}'
    return '{"say":""}'
  })
  const agent = createLlmAgent({ modelId: 'kimi', client })
  const { applyDecision } = await import('../server/engine/game.ts')
  // Team approved but the quest has NOT resolved yet: the approval carries no
  // signal on its own (its test is the quest result to come), so no reflect.
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [0, 1] })
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
  assert.ok(g.quests.every((q) => q.result === undefined), 'quest must not have resolved for this to isolate the approval')

  await agent.decide({ kind: 'vote', seat: 0, round: 1, proposalNum: 1 }, viewFor(g, 0))
  assert.ok(!client.calls.map((c) => c.tag).includes('kimi/reflect'), 'an approved reveal alone should not reflect')
})

test('AVALON_REFLECT_CADENCE=resolve suppresses the vote-triggered reflect', async () => {
  const g = createGame({ seed: 'llm-vote-reflect', playerCount: 5, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
  const client = fakeClient((opts) => {
    if (opts.tag?.endsWith('/reflect')) return '{"suspicions":[],"plan":"x"}'
    if (opts.tag?.endsWith('/vote')) return '{"vote":"reject"}'
    if (opts.tag?.endsWith('/propose')) return '{"team":[0,1]}'
    return '{"say":""}'
  })
  const agent = createLlmAgent({ modelId: 'kimi', client })
  const { applyDecision } = await import('../server/engine/game.ts')
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [0, 1] })
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'reject' })

  const prev = process.env.AVALON_REFLECT_CADENCE
  process.env.AVALON_REFLECT_CADENCE = 'resolve'
  try {
    await agent.decide({ kind: 'vote', seat: 0, round: 1, proposalNum: 2 }, viewFor(g, 0))
  } finally {
    if (prev === undefined) delete process.env.AVALON_REFLECT_CADENCE
    else process.env.AVALON_REFLECT_CADENCE = prev
  }
  assert.ok(!client.calls.map((c) => c.tag).includes('kimi/reflect'), 'resolve cadence should not reflect on a vote reveal')
})
