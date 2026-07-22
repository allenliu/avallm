// Text rendering of public game events for the sim transcript and CLI play.

import type { Game, GameEvent, Seat } from '../engine/types.ts'

function name(game: Game, seat: Seat): string {
  return `${game.players[seat].name}(${seat})`
}

export function renderEvent(ev: GameEvent, game: Game): string | null {
  const p = ev.payload as Record<string, any>
  switch (ev.type) {
    case 'gameCreated':
      return `=== Avalon: ${p.playerCount} players, roles: ${(p.rolesInPlay as string[]).join(', ')} ===\n` +
        `First leader: ${name(game, p.firstLeader)}`
    case 'utterance':
      return p.text ? `  ${name(game, p.seat)}: "${p.text}"` : null
    case 'proposal':
      return `\n[Q${p.round}.${p.proposalNum}] ${name(game, p.leader)} proposes: ${(p.team as Seat[]).map((s) => name(game, s)).join(', ')}`
    case 'voteReveal': {
      const votes = (p.votes as { seat: Seat; vote: string }[])
        .map((v) => `${name(game, v.seat)}:${v.vote === 'approve' ? 'Y' : 'N'}`).join(' ')
      return `  votes: ${votes} -> ${p.approved ? 'APPROVED' : 'rejected'}`
    }
    case 'questResult':
      return `  Quest ${p.round}: ${String(p.result).toUpperCase()} (${p.failCount} fail${p.failCount === 1 ? '' : 's'}, needed ${p.failsRequired})`
    case 'assassination':
      return `\nAssassin ${name(game, p.assassin)} targets ${name(game, p.target)} — ${p.wasMerlin ? 'MERLIN! Evil wins.' : 'not Merlin.'}`
    case 'gameOver':
      return `\n*** ${String(p.winner).toUpperCase()} wins (${p.reason}) ***`
    default:
      return null // private events are not rendered publicly
  }
}

export function revealRoles(game: Game): string {
  return 'Roles: ' + game.players
    .map((p) => `${name(game, p.seat)}=${p.role}`)
    .join(', ')
}
