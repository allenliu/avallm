// The facts dossier (design-evaluation.md §1.2, the engine-owned "facts layer").
//
// LLMs are mediocre at deduction over a raw transcript and worse at ACTING on
// their own deductions (the deduction-action gap — AvalonBench §4, research-
// strategy.md §4.5). The fix the literature converged on is to COMPUTE the
// signals deterministically and hand them to the model as neutral facts. The
// heuristic agent already reasons over exactly these signals (heuristic.ts
// `suspicion`); this exposes the same computed record to the LLM bots, which
// were previously denied it.
//
// Rules that keep this a FACTS layer, not a policy layer (design doc §1.2):
//   - Derived ONLY from PlayerView, and ONLY from PUBLIC record (quest results,
//     the vote matrix) — every fact here is one any player at the table can
//     compute, so nothing leaks hidden information. Private knowledge stays in
//     knowledgeText.
//   - Presented as DATA, zero imperatives. What to DO about a fact is the
//     agent's policy, never stated here — so a custom agent competes on
//     strategy, not on bookkeeping ability.

import { MAX_PROPOSALS } from '../engine/rules.ts'
import type { PlayerView, Seat } from '../engine/types.ts'

const nameOf = (view: PlayerView, s: Seat) => `${view.players[s].name}(seat ${s})`

interface PlayerRecord {
  onQuests: { num: number; failed: boolean }[]
  ledFailed: number         // led a quest (approved) that failed
  approvedFailedOff: number // approved a team it was NOT on, which then failed
  rejectedSucceeded: number // voted reject on a team that was approved anyway and succeeded
}

function computeRecords(view: PlayerView): Map<Seat, PlayerRecord> {
  const rec = new Map<Seat, PlayerRecord>()
  for (const p of view.players) {
    rec.set(p.seat, { onQuests: [], ledFailed: 0, approvedFailedOff: 0, rejectedSucceeded: 0 })
  }

  // Quest membership from the ACTUAL played team (quest.team is the approved
  // proposal's team). Resolved quests only.
  for (const q of view.quests) {
    if (q.result === undefined || !q.team) continue
    const failed = q.result === 'fail'
    for (const s of q.team) rec.get(s)!.onQuests.push({ num: q.num, failed })
  }

  // Vote-matrix signals. Only APPROVED proposals produced a quest, so only they
  // carry an outcome; rejected proposals never played. Attribute against the
  // quest that resulted for that round.
  for (const prop of view.proposals) {
    if (!prop.approved || !prop.votes) continue
    const quest = view.quests[prop.round - 1]
    if (quest?.result === undefined) continue
    const failed = quest.result === 'fail'
    if (failed) rec.get(prop.leader)!.ledFailed += 1
    for (const v of prop.votes) {
      if (v.vote === 'approve' && failed && !prop.team.includes(v.seat)) {
        rec.get(v.seat)!.approvedFailedOff += 1
      } else if (v.vote === 'reject' && !failed) {
        rec.get(v.seat)!.rejectedSucceeded += 1
      }
    }
  }
  return rec
}

// Facts about the DECIDING seat's own resolved public positions — the
// commitment record (design doc §4). A concept shared with the eval's
// commitment ledger (server/eval/ledger.ts); that one scores completed games
// from the full log, this one renders live facts from the seat's view. Kept
// separate to avoid inverting the agents->eval layering; a future refactor
// could unify the core derivation.
function ownPositions(view: PlayerView): string[] {
  const out: string[] = []
  for (const prop of view.proposals) {
    if (!prop.approved || !prop.votes) continue
    const quest = view.quests[prop.round - 1]
    if (quest?.result === undefined) continue
    const mine = prop.votes.find((v) => v.seat === view.seat)
    const led = prop.leader === view.seat
    const team = prop.team.map((s) => view.players[s].name).join('/')
    if ((led || mine?.vote === 'approve') && quest.result === 'fail') {
      out.push(`You ${led ? 'PROPOSED' : 'APPROVED'} the Q${prop.round} team [${team}] → it FAILED.`)
    } else if (mine?.vote === 'reject' && quest.result === 'success') {
      out.push(`You REJECTED the Q${prop.round} team [${team}] → it SUCCEEDED.`)
    }
  }
  return out
}

// Eval-only A/B switch: the dossier lives in the engine-owned facts layer, so
// it can't be toggled per agent-def — AVALON_NO_DOSSIER=1 suppresses it
// globally so a paired sim can measure default vs. default-plus-dossier on the
// same seeds. Default (unset) = on. Not for production; a measurement lever.
// Read at call time so a harness can set it per process and tests can flip it.
export function dossierEnabled(): boolean {
  return process.env.AVALON_NO_DOSSIER !== '1'
}

// Returns '' when there is nothing derived to report yet (early game), so the
// prompt doesn't carry an empty section.
export function factsDossier(view: PlayerView): string {
  if (!dossierEnabled()) return ''
  const rec = computeRecords(view)
  const anyResolved = view.quests.some((q) => q.result !== undefined)
  if (!anyResolved) return ''

  const sections: string[] = []

  // Fail exposure — the hard evidence.
  const exposure: string[] = []
  const cleanNeverOn: string[] = []
  for (const p of view.players) {
    const r = rec.get(p.seat)!
    if (!r.onQuests.length) {
      cleanNeverOn.push(nameOf(view, p.seat))
      continue
    }
    const tags = r.onQuests.map((q) => `Q${q.num}(${q.failed ? 'FAIL' : 'ok'})`).join(', ')
    exposure.push(`  ${nameOf(view, p.seat)}: on ${tags}`)
  }
  if (exposure.length) sections.push(`Quest exposure:\n${exposure.join('\n')}`)
  if (cleanNeverOn.length) sections.push(`Never on a quest: ${cleanNeverOn.join(', ')}.`)

  // Vote/lead signals — only players with a non-zero signal.
  const signals: string[] = []
  for (const p of view.players) {
    const r = rec.get(p.seat)!
    const parts: string[] = []
    if (r.ledFailed) parts.push(`led ${r.ledFailed} failed quest${r.ledFailed > 1 ? 's' : ''}`)
    if (r.approvedFailedOff) parts.push(`approved ${r.approvedFailedOff} failed team${r.approvedFailedOff > 1 ? 's' : ''} it was not on`)
    if (r.rejectedSucceeded) parts.push(`rejected ${r.rejectedSucceeded} team${r.rejectedSucceeded > 1 ? 's' : ''} that then succeeded`)
    if (parts.length) signals.push(`  ${nameOf(view, p.seat)}: ${parts.join('; ')}`)
  }
  if (signals.length) sections.push(`Vote/lead signals (approved teams only):\n${signals.join('\n')}`)

  // The deciding seat's own resolved positions.
  const positions = ownPositions(view)
  if (positions.length) sections.push(`Your resolved public positions:\n${positions.map((p) => `  ${p}`).join('\n')}`)

  // Hammer proximity — how much rejection runway is left this round.
  const rejectsLeft = MAX_PROPOSALS - view.proposalNum
  if (rejectsLeft <= 2 && view.proposalNum < MAX_PROPOSALS) {
    sections.push(`Hammer proximity: proposal ${view.proposalNum} of ${MAX_PROPOSALS} this round — up to ${rejectsLeft} more proposal${rejectsLeft > 1 ? 's' : ''} can be rejected before the 5th is auto-approved.`)
  }

  if (!sections.length) return ''
  return `== DERIVED FACTS (computed from the public record — anyone at the table can derive these) ==\n${sections.join('\n')}`
}
