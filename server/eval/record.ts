// Render an archived game as text for LLM consumers (probe, judge).
// Two levels: publicRecord is strictly the table-visible record (what a
// spectator saw — the blinded input); fullRecord adds roles and every
// seat-private event (thinking, scratchpads, votes as cast, quest cards) —
// the judge's full-transparency input. Lines carry [seq N] tags so callers
// can cite exact moments.

import { sanitizeSpeech } from '../agents/prompts.ts'
import type { GameArtifact } from './artifact.ts'
import type { GameEvent, Seat } from '../engine/types.ts'

export function nameOf(a: GameArtifact, seat: Seat): string {
  return `${a.players[seat].name}(seat ${seat})`
}

function teamText(a: GameArtifact, team: Seat[]): string {
  return team.map((s) => a.players[s].name).join('/')
}

function eventLine(a: GameArtifact, ev: GameEvent, full: boolean): string | null {
  const p = ev.payload
  const tag = `[seq ${ev.seq}]`
  switch (ev.type) {
    case 'leadChange':
      return `${tag} — quest ${p.round as number}, proposal ${p.proposalNum as number}: ${nameOf(a, p.seat as Seat)} leads —`
    case 'utterance': {
      // sanitize-at-boundary: player/agent free text is untrusted and enters an
      // LLM prompt here (probe/judge), so strip injection markup exactly like
      // the live prompt path does (server/agents/prompts.ts).
      const text = sanitizeSpeech((p.text as string) ?? '')
      const lean = p.lean ? ` [leans ${p.lean as string}]` : ''
      return `${tag} ${nameOf(a, p.seat as Seat)}: ${text ? `"${text}"` : '(passes)'}${lean}`
    }
    case 'proposal': {
      const pitch = typeof p.pitch === 'string' ? ` — pitch: "${sanitizeSpeech(p.pitch)}"` : ''
      return `${tag} ${nameOf(a, p.leader as Seat)} proposes [${teamText(a, p.team as Seat[])}]${pitch}`
    }
    case 'proposalLocked':
      return `${tag} ${nameOf(a, p.leader as Seat)} locks in the team`
    case 'proposalRevised': {
      const reason = typeof p.reason === 'string' ? ` — "${sanitizeSpeech(p.reason)}"` : ''
      return `${tag} ${nameOf(a, p.leader as Seat)} REVISES the team to [${teamText(a, p.to as Seat[])}]${reason}`
    }
    case 'voteReveal': {
      if (p.auto === true) return `${tag} HAMMER: team [${teamText(a, p.team as Seat[])}] auto-approved, no vote`
      const votes = (p.votes as { seat: Seat; vote: string }[])
        .map((v) => `${a.players[v.seat].name}:${v.vote === 'approve' ? 'Y' : 'N'}`).join(' ')
      return `${tag} votes: ${votes} -> ${(p.approved as boolean) ? 'APPROVED' : 'rejected'}`
    }
    case 'questResult':
      return `${tag} QUEST ${p.round as number}: ${(p.result as string).toUpperCase()} (${p.failCount as number} fail cards, ${p.failsRequired as number} needed)`
    case 'assassination':
      return `${tag} assassination: ${nameOf(a, p.assassin as Seat)} names ${nameOf(a, p.target as Seat)} as Merlin -> ${(p.wasMerlin as boolean) ? 'CORRECT' : 'wrong'}`
    case 'gameOver':
      return `${tag} GAME OVER: ${p.winner as string} wins (${p.reason as string})`
    case 'rename':
      return `${tag} (${p.from as string} changed name to ${p.to as string})`
    // ---- private events: full record only ----
    case 'thinking':
      return full ? `${tag} [private thinking, ${nameOf(a, p.seat as Seat)} on ${p.kind as string}]: ${sanitizeSpeech(p.text as string)}` : null
    case 'scratchpad':
      return full ? `${tag} [private notes, ${nameOf(a, p.seat as Seat)}]: ${sanitizeSpeech(p.text as string)}` : null
    case 'voteCast':
      return full ? `${tag} [private] ${nameOf(a, p.seat as Seat)} votes ${p.vote as string}` : null
    case 'questCard':
      return full ? `${tag} [private] ${nameOf(a, p.seat as Seat)} plays ${p.card as string}` : null
    default:
      return null // gameCreated/roleDealt/knowledge: covered by the headers
  }
}

function header(a: GameArtifact, withRoles: boolean, withOutcome: boolean): string {
  const players = a.players
    .map((p) => withRoles
      ? `${p.name}(seat ${p.seat}) = ${p.role.toUpperCase()} (${p.alignment})`
      : `${p.name}(seat ${p.seat})`)
    .join(', ')
  const roles = (a.log[0]?.payload?.rolesInPlay as string[] | undefined)?.join(', ') ?? ''
  return [
    `Players: ${players}.`,
    `Roles in play: ${roles}.`,
    `${a.playerCount} players.${withOutcome ? ` Result: ${a.winner} wins (${a.winReason}).` : ''}`,
  ].join('\n')
}

// excludeOutcome: stop the record before the endgame (no assassination, no
// gameOver, no result line) — required for the virtual-assassin probe, which
// must not see how the real endgame went.
export function publicRecord(a: GameArtifact, opts: { excludeOutcome?: boolean } = {}): string {
  const lines = a.log
    .filter((ev) => ev.visibility === 'public')
    .filter((ev) => !(opts.excludeOutcome && (ev.type === 'assassination' || ev.type === 'gameOver')))
    .map((ev) => eventLine(a, ev, false))
    .filter((l): l is string => l !== null)
  return `${header(a, false, !opts.excludeOutcome)}\n\n${lines.join('\n')}`
}

export function fullRecord(a: GameArtifact): string {
  const lines = a.log
    .map((ev) => eventLine(a, ev, true))
    .filter((l): l is string => l !== null)
  return `${header(a, true, true)}\n\n${lines.join('\n')}`
}
