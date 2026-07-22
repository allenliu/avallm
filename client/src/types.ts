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
  discussionSlot?: 'pre' | 'post'
  discussionRound?: number
  transcript: { seat: Seat; name: string; text: string; lean?: string }[]
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

export interface AgentInfo {
  id: string
  name: string
  version?: string
  author?: string
  about?: string
  model: string
  color: string
  monogram: string
  personality?: string
  custom: boolean
}

export interface Library {
  agents: AgentInfo[]
  models: { id: string; name: string; slug: string; tier: string }[]
  baseline?: { rulesDigest: string; roleGuidance: Record<string, string> }
}

export interface ServerPayload {
  view: PlayerView
  ask: DecisionRequest[]
  acting: Seat[]
  waitingOn: string[]
  degraded: number
  degradedSeqs: number[]
  bots: Record<number, AgentInfo>
  spectator: boolean
}

export interface LobbyPayload {
  id: string
  status: 'open' | 'started'
  gameId?: string
  playerCount: number
  humanSeats: number
  openSeats: number
  members: string[]
  spectators: number
  hostName: string
  table: string[]
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

