// Client-side mirror of the server's human payload (server/server.ts).

export type Seat = number
export type Alignment = 'good' | 'evil'
export type Phase = 'discussion' | 'proposal' | 'vote' | 'quest' | 'assassination' | 'gameOver'

export interface Quest {
  num: number
  teamSize: number
  failsRequired: number
  team?: Seat[]
  result?: 'success' | 'fail'
  failCount?: number
}

export interface ProposalRecord {
  round: number
  proposalNum: number
  leader: Seat
  team: Seat[]
  pitch?: string
  votes?: { seat: Seat; vote: 'approve' | 'reject' }[]
  approved?: boolean
}

export interface GameEvent {
  seq: number
  type: string
  payload: Record<string, any>
  visibility: 'public' | { only: Seat[] }
}

export interface PlayerView {
  seat: Seat
  name: string
  role: string
  alignment: Alignment
  privateInfo: { evilPartners?: Seat[]; knownEvil?: Seat[]; merlinCandidates?: Seat[] }
  playerCount: number
  rolesInPlay: string[]
  players: { seat: Seat; name: string }[]
  phase: Phase
  round: number
  proposalNum: number
  leaderSeat: Seat
  quests: Quest[]
  proposals: ProposalRecord[]
  currentTeam?: Seat[]
  transcript: { seat: Seat; name: string; text: string }[]
  events: GameEvent[]
  winner?: Alignment
  winReason?: string
}

export interface DecisionRequest {
  kind: 'discuss' | 'propose' | 'vote' | 'quest' | 'assassinate'
  seat: Seat
  round: number
  proposalNum: number
}

export interface ServerPayload {
  view: PlayerView
  ask: DecisionRequest[]
  acting: Seat[]
  degraded: number
  bots: Record<number, string>
}

export interface RevealPlayer {
  seat: Seat
  name: string
  role: string
  alignment: Alignment
}

export interface RevealPayload {
  players: RevealPlayer[]
  log: GameEvent[]
  degraded: { seat: Seat; kind: string; error: string }[]
}

// Mirror of server/llm/roster.ts badges (display only).
export const BADGES: Record<string, { color: string; monogram: string }> = {
  deepseek: { color: '#4D6BFE', monogram: 'DS' },
  gemini: { color: '#1A73E8', monogram: 'GM' },
  'gemini-flash': { color: '#34A853', monogram: 'GF' },
  haiku: { color: '#D97757', monogram: 'HK' },
  kimi: { color: '#16A8A8', monogram: 'KM' },
  glm: { color: '#8B5CF6', monogram: 'GL' },
  'gpt-oss': { color: '#10A37F', monogram: 'GP' },
  seed: { color: '#F0424C', monogram: 'SD' },
}
