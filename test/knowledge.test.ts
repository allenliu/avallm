// The role knowledge matrix (research doc §3.3), asserted through viewFor —
// the exact surface agents and clients consume.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type { Game, Player, Seat } from '../server/engine/types.ts'

const sorted = (xs: Seat[]) => xs.slice().sort((a, b) => a - b)
const seatsWhere = (g: Game, pred: (p: Player) => boolean) =>
  sorted(g.players.filter(pred).map((p) => p.seat))

test('knowledge matrix holds for every role, player count, and seed', () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    for (let s = 0; s < 20; s++) {
      const g = createGame({ seed: `km-${playerCount}-${s}`, playerCount })
      const evil = seatsWhere(g, (p) => p.alignment === 'evil')

      for (const me of g.players) {
        const view = viewFor(g, me.seat)
        const info = view.privateInfo
        const ctx = `players=${playerCount} seed=${s} seat=${me.seat} role=${me.role}`

        if (me.role === 'merlin') {
          const expected = seatsWhere(g, (p) => p.alignment === 'evil' && p.role !== 'mordred')
          assert.deepEqual(sorted(info.knownEvil!), expected, `merlin sees evil minus mordred: ${ctx}`)
          assert.equal(info.evilPartners, undefined, ctx)
          assert.equal(info.merlinCandidates, undefined, ctx)
        } else if (me.role === 'percival') {
          const expected = seatsWhere(g, (p) => p.role === 'merlin' || p.role === 'morgana')
          assert.deepEqual(sorted(info.merlinCandidates!), expected, `percival pair: ${ctx}`)
          assert.equal(info.knownEvil, undefined, ctx)
          assert.equal(info.evilPartners, undefined, ctx)
        } else if (me.role === 'oberon' || me.alignment === 'good') {
          // Oberon and Servants learn nothing.
          assert.deepEqual(info, {}, `no knowledge: ${ctx}`)
        } else {
          // Evil (non-Oberon): fellow evil, minus Oberon, minus self.
          const expected = seatsWhere(
            g, (p) => p.alignment === 'evil' && p.role !== 'oberon' && p.seat !== me.seat,
          )
          assert.deepEqual(sorted(info.evilPartners!), expected, `evil partners: ${ctx}`)
          assert.ok(!info.evilPartners!.includes(me.seat), ctx)
          assert.equal(info.knownEvil, undefined, ctx)
        }

        // Sanity: nobody's private info names a good player as evil.
        for (const s2 of [...(info.knownEvil ?? []), ...(info.evilPartners ?? [])]) {
          assert.ok(evil.includes(s2), `${ctx}: seat ${s2} flagged evil but is good`)
        }
      }
    }
  }
})
