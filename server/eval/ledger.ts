// The commitment ledger (docs/design-evaluation.md §4): a pure function over
// the PUBLIC event log reconstructing each player's public positions on
// proposed teams — and the quest results that contradicted them.
//
// Three consumers by design: the reactivity metric (here, via the
// silent-after-contradiction flags), judge incident citations, and — later —
// the facts dossier in prompts. Because prompts may eventually surface this,
// the ledger reads ONLY public events: everything it derives is knowledge any
// player at the table already has.
//
// What counts as a commitment (deterministic sources only — speech content
// analysis is judge territory):
//   - proposing a team          -> 'for' that team  (via 'proposal')
//   - revising a team at
//     finalize                  -> 'for' the NEW team (via 'proposal'); positions
//                                  taken on the old team stay recorded but can
//                                  never be contradicted (like a rejected team)
//   - a lean signal on the
//     pending team              -> 'for'/'against'  (via 'lean'; 'unsure' is none)
//   - a revealed vote           -> 'for'/'against'  (via 'vote'; hammer auto-
//                                  approvals have no votes, so no commitments)
//
// What counts as a contradiction: only APPROVED teams resolve, so only their
// commitments can be contradicted. A fail contradicts every 'for' on that
// team; a clean success contradicts every 'against'. Downstream flags use
// only endorsedTeamFailed — rejecting a team that turns out clean is normal
// strategic caution, but publicly backing a team that then fails demands a
// reaction (the motivating incident: a bot that twice defended a team,
// watched it fail, and silently passed).

import type { GameEvent, Seat } from '../engine/types.ts'

export interface Commitment {
  seat: Seat
  stance: 'for' | 'against'
  round: number
  proposalNum: number
  team: Seat[]
  seq: number // event that created the commitment
  via: 'proposal' | 'lean' | 'vote'
}

export interface Contradiction {
  commitment: Commitment
  seq: number // event that contradicted it (the questResult)
  kind: 'endorsedTeamFailed' | 'opposedTeamSucceeded'
}

// A pass (empty say) while holding an endorsedTeamFailed contradiction newer
// than the seat's last actual speech. Every qualifying pass is flagged — a
// player staying silent for three turns after their endorsed team failed is
// three data points, not one.
export interface SilenceFlag {
  seat: Seat
  seq: number // the pass utterance
  contradictions: Contradiction[]
}

export interface Ledger {
  commitments: Commitment[]
  contradictions: Contradiction[]
  silentAfterContradiction: SilenceFlag[]
}

interface PendingProposal {
  round: number
  proposalNum: number
  team: Seat[]
  commitments: Commitment[]
}

export function buildLedger(log: GameEvent[]): Ledger {
  const commitments: Commitment[] = []
  const contradictions: Contradiction[] = []
  const flags: SilenceFlag[] = []

  let pending: PendingProposal | undefined
  // Approved team awaiting its questResult, keyed by round.
  const approvedByRound = new Map<number, PendingProposal>()
  const lastSpeech = new Map<Seat, number>() // seat -> seq of last non-empty utterance

  const add = (c: Commitment, into: PendingProposal | undefined) => {
    commitments.push(c)
    into?.commitments.push(c)
  }

  for (const ev of log) {
    if (ev.visibility !== 'public') continue
    const p = ev.payload

    switch (ev.type) {
      case 'proposal': {
        pending = {
          round: p.round as number,
          proposalNum: p.proposalNum as number,
          team: (p.team as Seat[]).slice(),
          commitments: [],
        }
        add({
          seat: p.leader as Seat, stance: 'for',
          round: pending.round, proposalNum: pending.proposalNum,
          team: pending.team, seq: ev.seq, via: 'proposal',
        }, pending)
        break
      }

      case 'proposalRevised': {
        // Fresh pending record for the new team: old-team commitments stay in
        // the global ledger but never enter the approved set, so the revised
        // team's quest result cannot contradict them.
        pending = {
          round: p.round as number,
          proposalNum: p.proposalNum as number,
          team: (p.to as Seat[]).slice(),
          commitments: [],
        }
        add({
          seat: p.leader as Seat, stance: 'for',
          round: pending.round, proposalNum: pending.proposalNum,
          team: pending.team, seq: ev.seq, via: 'proposal',
        }, pending)
        break
      }

      case 'utterance': {
        const seat = p.seat as Seat
        const text = (p.text as string) ?? ''
        const lean = p.lean as 'approve' | 'reject' | 'unsure' | undefined
        if (pending && (lean === 'approve' || lean === 'reject')) {
          add({
            seat, stance: lean === 'approve' ? 'for' : 'against',
            round: pending.round, proposalNum: pending.proposalNum,
            team: pending.team, seq: ev.seq, via: 'lean',
          }, pending)
        }
        if (text.trim() === '') {
          const owed = contradictions.filter((c) =>
            c.kind === 'endorsedTeamFailed'
            && c.commitment.seat === seat
            && c.seq > (lastSpeech.get(seat) ?? -1)
            && c.seq < ev.seq)
          if (owed.length) flags.push({ seat, seq: ev.seq, contradictions: owed })
        } else {
          lastSpeech.set(seat, ev.seq)
        }
        break
      }

      case 'voteReveal': {
        const round = p.round as number
        const target = pending
          ?? { round, proposalNum: p.proposalNum as number, team: (p.team as Seat[]).slice(), commitments: [] }
        const votes = (p.votes as { seat: Seat; vote: 'approve' | 'reject' }[]) ?? []
        for (const v of votes) {
          add({
            seat: v.seat, stance: v.vote === 'approve' ? 'for' : 'against',
            round: target.round, proposalNum: target.proposalNum,
            team: target.team, seq: ev.seq, via: 'vote',
          }, target)
        }
        if (p.approved as boolean) approvedByRound.set(round, target)
        pending = undefined
        break
      }

      case 'questResult': {
        const round = p.round as number
        const result = p.result as 'success' | 'fail'
        const approved = approvedByRound.get(round)
        if (!approved) break
        for (const c of approved.commitments) {
          if (result === 'fail' && c.stance === 'for') {
            contradictions.push({ commitment: c, seq: ev.seq, kind: 'endorsedTeamFailed' })
          } else if (result === 'success' && c.stance === 'against') {
            contradictions.push({ commitment: c, seq: ev.seq, kind: 'opposedTeamSucceeded' })
          }
        }
        break
      }
    }
  }

  return { commitments, contradictions, silentAfterContradiction: flags }
}
