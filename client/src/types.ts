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
  auto?: boolean   // 5th ("hammer") proposal: approved automatically, no vote
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
  version?: number
  author?: string
  about?: string
  model: string
  color: string
  monogram: string
  personality?: string
  strategy?: string
  roleGuidance?: Record<string, string>
  roleGuidanceMode?: 'replace' | 'append'
  kindGuidance?: Record<string, string>
  temperature?: number
  // The def's raw model suggestion (roster id), if any; `model` is always the
  // resolved display slug.
  suggestedModel?: string
  tunedChars: number
  custom: boolean
  tier: 'builtin' | 'curated' | 'user'
  unavailable?: string
}

// One bot seat sent to the server: which agent, and optionally which model
// it runs on (overrides the agent's own suggestion; server default backstops).
export interface TableSeat {
  agent: string
  model?: string
}

export interface Library {
  agents: AgentInfo[]
  problems?: { file: string; reason: string }[]
  models: { id: string; name: string; slug: string; tier: string }[]
  baseline?: {
    rulesDigest: string
    roleGuidance: Record<string, string>
    tableTalkNorms?: string
    outputContracts?: Record<string, string>
    kinds?: string[]
    previewRoles?: string[]
    caps?: { field: number; aggregate: number }
  }
  gated?: boolean
  defaultTable?: string[]
  defaultModel?: string
}

export interface PreviewResponse {
  messages: { role: string; content: string }[]
  rolesInPlay: string[]
  kinds: string[]
  tokenEstimate: number
  error?: string
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
  table: { name: string; model: string }[]
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
  // Def snapshots taken at game start — the configs that actually played.
  agents?: Record<number, AgentInfo>
}

