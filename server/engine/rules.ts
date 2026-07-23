// Rules reference tables — transcribed from docs/research-rules-and-visuals.md §3.
// Voting: strict-majority approval (tie = reject). House rule (deviation from
// the official "5th rejection = evil wins"): the 5th proposal in a round is
// approved automatically without a vote, so only 4 proposals can be rejected.

import type { Alignment, Player, PrivateInfo, Role, Seat } from './types.ts'

export const MIN_PLAYERS = 5
export const MAX_PLAYERS = 10
export const MAX_PROPOSALS = 5
export const QUESTS_PER_GAME = 5
export const QUESTS_TO_WIN = 3

export const TEAM_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
}

export const EVIL_COUNT: Record<number, number> = {
  5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4,
}

// Only quest 4, only at 7+ players, requires 2 fail cards.
export function failsRequired(playerCount: number, questNum: number): number {
  return playerCount >= 7 && questNum === 4 ? 2 : 1
}

export const ROLE_ALIGNMENT: Record<Role, Alignment> = {
  merlin: 'good', percival: 'good', servant: 'good',
  assassin: 'evil', morgana: 'evil', mordred: 'evil', oberon: 'evil', minion: 'evil',
}

// De-facto standard digital setups (research doc §3.4).
export const DEFAULT_ROLES: Record<number, Role[]> = {
  5: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
  6: ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin'],
  7: ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon'],
  8: ['merlin', 'percival', 'servant', 'servant', 'servant', 'morgana', 'assassin', 'minion'],
  9: ['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'morgana', 'assassin', 'mordred'],
  10: ['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'morgana', 'assassin', 'mordred', 'oberon'],
}

export function validateRoles(playerCount: number, roles: Role[]): void {
  if (roles.length !== playerCount) {
    throw new Error(`roles length ${roles.length} !== playerCount ${playerCount}`)
  }
  const evil = roles.filter((r) => ROLE_ALIGNMENT[r] === 'evil').length
  if (evil !== EVIL_COUNT[playerCount]) {
    throw new Error(`role set has ${evil} evil, expected ${EVIL_COUNT[playerCount]} for ${playerCount} players`)
  }
  const has = (r: Role) => roles.includes(r)
  if (has('merlin') !== has('assassin')) {
    throw new Error('merlin and assassin must be added together')
  }
  const unique: Role[] = ['merlin', 'percival', 'assassin', 'morgana', 'mordred', 'oberon']
  for (const r of unique) {
    if (roles.filter((x) => x === r).length > 1) throw new Error(`duplicate unique role: ${r}`)
  }
}

// ---- name policy ----
// A display name is injected verbatim into every OTHER player's LLM prompt
// (and echoed in their speech), so it must be an unambiguous identity token.
// A first/second-person pronoun ("You", "Me", "I") is read by the model as
// referring to itself — a human named "You" makes every bot think it is the
// leader, on the team, etc. Game terms ("leader") and system words collide
// with the prompt's own structure. These are rejected at the boundary; the
// human's own view renders "You" client-side instead of storing it as a name.
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'you', 'u', 'me', 'i', 'myself', 'self', 'we', 'us',
  'system', 'assistant', 'narrator', 'leader',
])

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function nameIsReserved(name: string): boolean {
  return RESERVED_NAMES.has(normalizeName(name))
}

// Seat numbers are handed to models ONLY so they can fill the team/vote/target
// JSON fields; the table UI shows names, not seats. Models nonetheless leak
// "seat 3" / "player 3" into their spoken text, where it is noise to humans and
// other bots alike. Rewrite any such reference to the name at that seat as the
// utterance/pitch enters the log (the single source both UI and prompts read).
export function stripSeatRefs(text: string, players: Player[]): string {
  return text.replace(/\b(?:seats?|players?)\s*#?\s*(\d+)\b/gi, (m, d) => {
    const n = Number(d)
    return n >= 0 && n < players.length ? players[n].name : m
  })
}

// The knowledge matrix (research doc §3.3). The ONLY producer of night-phase
// knowledge — deal, viewFor, and tests all share it.
export function computeKnowledge(players: Player[], seat: Seat): PrivateInfo {
  const me = players[seat]
  const info: PrivateInfo = {}
  const seatsOf = (pred: (p: Player) => boolean) =>
    players.filter(pred).map((p) => p.seat).sort((a, b) => a - b)

  if (me.role === 'merlin') {
    info.knownEvil = seatsOf((p) => p.alignment === 'evil' && p.role !== 'mordred')
  } else if (me.role === 'percival') {
    info.merlinCandidates = seatsOf((p) => p.role === 'merlin' || p.role === 'morgana')
  } else if (me.alignment === 'evil' && me.role !== 'oberon') {
    info.evilPartners = seatsOf(
      (p) => p.alignment === 'evil' && p.role !== 'oberon' && p.seat !== seat,
    )
  }
  // Oberon and Servants learn nothing.
  return info
}
