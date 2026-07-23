// Hidden-information leak checks on viewFor: structural (event visibility,
// player objects carry no role fields) and textual (no role words in the
// public-shaped parts of a view).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor, viewForSpectator, eventVisibleTo } from '../server/engine/view.ts'
import { createHeuristicAgent } from '../server/agents/heuristic.ts'
import { runGame } from '../server/sim/runner.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import type { Game, PlayerView, Seat } from '../server/engine/types.ts'

const ROLE_WORDS = /merlin|percival|servant|assassin|morgana|mordred|oberon|minion/i
const PRIVATE_EVENT_TYPES = new Set(['roleDealt', 'knowledge', 'voteCast', 'questCard', 'thinking', 'scratchpad'])

function assertNoLeaks(g: Game, seat: Seat): void {
  const view = viewFor(g, seat)
  const ctx = `seat=${seat} phase=${g.phase}`

  // Other players are seat+name only.
  for (const p of view.players) {
    assert.deepEqual(Object.keys(p).sort(), ['name', 'seat'], ctx)
  }

  // Every event in the view is legitimately visible to this seat, and private
  // event types never appear for another seat.
  for (const ev of view.events) {
    assert.ok(eventVisibleTo(ev, seat), `${ctx}: leaked event seq=${ev.seq} type=${ev.type}`)
    if (PRIVATE_EVENT_TYPES.has(ev.type)) {
      assert.equal(ev.payload.seat, seat, `${ctx}: private ${ev.type} for another seat`)
    }
  }

  // The public-shaped parts of the view must never mention a role word.
  // (rolesInPlay, own role/privateInfo, and post-game reveals like
  // winReason='merlinAssassinated' are legitimate and excluded.)
  const publicShaped = JSON.stringify({
    players: view.players,
    quests: view.quests,
    proposals: view.proposals,
    currentTeam: view.currentTeam,
    transcript: view.transcript,
  })
  assert.ok(!ROLE_WORDS.test(publicShaped), `${ctx}: role word in public view: ${publicShaped.match(ROLE_WORDS)?.[0]}`)
}

test('fresh games leak nothing, any player count', () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    for (let s = 0; s < 10; s++) {
      const g = createGame({ seed: `leak-${playerCount}-${s}`, playerCount })
      for (const p of g.players) assertNoLeaks(g, p.seat)
    }
  }
})

test('completed heuristic games leak nothing at any seat', async () => {
  for (const playerCount of [5, 7, 10]) {
    for (let s = 0; s < 5; s++) {
      const seed = `leak-full-${playerCount}-${s}`
      const g = createGame({ seed, playerCount, talk: { preProposal: 1, postProposal: 0 } })
      const agents = new Map<Seat, AvalonAgent>(
        g.players.map((p) => [p.seat, createHeuristicAgent({ seed, seat: p.seat })]),
      )
      await runGame({ game: g, agents })
      for (const p of g.players) assertNoLeaks(g, p.seat)
    }
  }
})

test('spectator views carry only public events and no private info', async () => {
  const seed = 'leak-spec'
  const g = createGame({ seed, playerCount: 7, talk: { preProposal: 1, postProposal: 0 } })
  const agents = new Map<Seat, AvalonAgent>(
    g.players.map((p) => [p.seat, createHeuristicAgent({ seed, seat: p.seat })]),
  )
  await runGame({ game: g, agents })
  const view = viewForSpectator(g)
  assert.equal(view.role, 'spectator')
  assert.deepEqual(view.privateInfo, {})
  for (const ev of view.events) {
    assert.equal(ev.visibility, 'public', `spectator saw private event seq=${ev.seq} type=${ev.type}`)
  }
  for (const p of view.players) {
    assert.deepEqual(Object.keys(p).sort(), ['name', 'seat'])
  }
})

test('a servant view carries no private info at all', () => {
  const g = createGame({ seed: 'leak-servant', playerCount: 7 })
  const servant = g.players.find((p) => p.role === 'servant')!
  const view: PlayerView = viewFor(g, servant.seat)
  assert.deepEqual(view.privateInfo, {})
})
