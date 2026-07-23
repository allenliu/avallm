// Programmatic behavioral metrics over game artifacts
// (docs/design-evaluation.md §3). Pure functions, zero LLM cost. These are
// the unfakeable half of the eval signal — the judge's scores are advisory,
// these are ground truth.
//
// Conspicuousness: how truth-aligned each player's public discrimination was
// (votes/leans vs. ground-truth evil on the team). Merlin should NOT be the
// top-ranked good player — a Merlin whose public record out-discriminates
// every servant is telegraphing private knowledge (the motivating incident:
// a Merlin declaring "no trust X" every turn about a hidden evil).
// Speech-content accusations are deliberately out of scope here: that
// analysis needs judgment, so it belongs to the judge.

import { buildLedger } from './ledger.ts'
import type { Ledger } from './ledger.ts'
import type { GameArtifact } from './artifact.ts'
import type { Alignment, Role, Seat } from '../engine/types.ts'

export interface SeatMetrics {
  seat: Seat
  name: string
  role: Role
  alignment: Alignment
  agent: string
  won: boolean
  votes: number            // revealed votes cast (hammer auto-approvals have none)
  voteScore: number | null // fraction of votes matching ground truth: reject iff team contains evil
  leans: number            // approve/reject lean signals given
  leanScore: number | null // same correctness measure over leans
  utterances: number       // non-empty says
  passes: number           // empty says
  silentContradictions: number // ledger flags: passed while owing a reaction
}

export interface GameMetrics {
  id: string
  seed: string
  tags?: Record<string, string>
  winner: Alignment
  winReason: string
  degradedCount: number
  seats: SeatMetrics[]
  merlin?: {
    seat: Seat
    agent: string
    voteScore: number | null
    // Rank of Merlin's voteScore among good players (1 = most truth-aligned =
    // most conspicuous). null when Merlin cast no revealed votes.
    conspicuousnessRank: number | null
    goodPlayers: number
    assassinated: boolean | null // null: game never reached assassination
    virtualAssassinRate: number | null // probe hit rate, null if not probed
  }
  assassination?: { assassin: Seat; target: Seat; wasMerlin: boolean }
  judge?: {
    model: string
    blindedMerlinCorrect: boolean
    blindedEvilCorrect: number
    incidents: { seat: Seat; family: string }[]
  }
}

export function computeMetrics(a: GameArtifact): GameMetrics {
  const isEvil = (s: Seat) => a.players[s].alignment === 'evil'
  const teamHasEvil = (team: Seat[]) => team.some(isEvil)

  const votes = new Map<Seat, { n: number; correct: number }>()
  const leans = new Map<Seat, { n: number; correct: number }>()
  const talk = new Map<Seat, { utterances: number; passes: number }>()
  for (const p of a.players) {
    votes.set(p.seat, { n: 0, correct: 0 })
    leans.set(p.seat, { n: 0, correct: 0 })
    talk.set(p.seat, { utterances: 0, passes: 0 })
  }

  // Team on the table while discussion leans arrive (proposal -> voteReveal).
  let pendingTeam: Seat[] | undefined
  let assassination: GameMetrics['assassination']

  for (const ev of a.log) {
    if (ev.visibility !== 'public') continue
    const p = ev.payload
    switch (ev.type) {
      case 'proposal':
        pendingTeam = (p.team as Seat[]).slice()
        break
      case 'utterance': {
        const seat = p.seat as Seat
        const t = talk.get(seat)!
        if (((p.text as string) ?? '').trim() === '') t.passes++
        else t.utterances++
        const lean = p.lean as string | undefined
        if (pendingTeam && (lean === 'approve' || lean === 'reject')) {
          const e = leans.get(seat)!
          e.n++
          if ((lean === 'reject') === teamHasEvil(pendingTeam)) e.correct++
        }
        break
      }
      case 'voteReveal': {
        const team = (p.team as Seat[]) ?? []
        for (const v of (p.votes as { seat: Seat; vote: string }[]) ?? []) {
          const e = votes.get(v.seat)!
          e.n++
          if ((v.vote === 'reject') === teamHasEvil(team)) e.correct++
        }
        pendingTeam = undefined
        break
      }
      case 'assassination':
        assassination = {
          assassin: p.assassin as Seat,
          target: p.target as Seat,
          wasMerlin: p.wasMerlin as boolean,
        }
        break
    }
  }

  const ledger: Ledger = buildLedger(a.log)
  const silentBySeat = new Map<Seat, number>()
  for (const f of ledger.silentAfterContradiction) {
    silentBySeat.set(f.seat, (silentBySeat.get(f.seat) ?? 0) + 1)
  }

  const score = (e: { n: number; correct: number }) => (e.n ? e.correct / e.n : null)
  const seats: SeatMetrics[] = a.players.map((p) => ({
    seat: p.seat,
    name: p.name,
    role: p.role,
    alignment: p.alignment,
    agent: p.agent,
    won: p.alignment === a.winner,
    votes: votes.get(p.seat)!.n,
    voteScore: score(votes.get(p.seat)!),
    leans: leans.get(p.seat)!.n,
    leanScore: score(leans.get(p.seat)!),
    utterances: talk.get(p.seat)!.utterances,
    passes: talk.get(p.seat)!.passes,
    silentContradictions: silentBySeat.get(p.seat) ?? 0,
  }))

  let merlin: GameMetrics['merlin']
  const m = seats.find((s) => s.role === 'merlin')
  if (m) {
    const good = seats.filter((s) => s.alignment === 'good')
    const rank = m.voteScore === null
      ? null
      : 1 + good.filter((s) => s.voteScore !== null && s.voteScore > m.voteScore!).length
    merlin = {
      seat: m.seat,
      agent: m.agent,
      voteScore: m.voteScore,
      conspicuousnessRank: rank,
      goodPlayers: good.length,
      assassinated: assassination ? assassination.wasMerlin : null,
      virtualAssassinRate: a.probes?.virtualAssassin?.hitRate ?? null,
    }
  }

  const judge = a.judge
    ? {
        model: a.judge.model,
        blindedMerlinCorrect: a.judge.blinded.merlinCorrect,
        blindedEvilCorrect: a.judge.blinded.evilCorrect,
        incidents: a.judge.incidents.map((i) => ({ seat: i.seat as Seat, family: i.family })),
      }
    : undefined

  return {
    id: a.id,
    seed: a.seed,
    ...(a.tags ? { tags: a.tags } : {}),
    winner: a.winner,
    winReason: a.winReason,
    degradedCount: a.degraded.length,
    seats,
    ...(merlin ? { merlin } : {}),
    ...(assassination ? { assassination } : {}),
    ...(judge ? { judge } : {}),
  }
}
