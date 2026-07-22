// Core engine types. The engine is pure: no I/O, no Date.now, no unseeded randomness.

export type Role =
  | 'merlin' | 'percival' | 'servant'
  | 'assassin' | 'morgana' | 'mordred' | 'oberon' | 'minion'

export type Alignment = 'good' | 'evil'

export type Seat = number

export type Phase =
  | 'discussion' | 'proposal' | 'vote' | 'quest' | 'assassination' | 'gameOver'

export interface TalkConfig {
  preProposal: number   // table-talk rounds before each proposal
  postProposal: number  // table-talk rounds between proposal and vote
}

export interface GameConfig {
  playerCount: number
  roles: Role[]         // length === playerCount
  names: string[]       // length === playerCount
  talk: TalkConfig
}

export interface Player {
  seat: Seat
  name: string
  role: Role
  alignment: Alignment
}

export interface Quest {
  num: number                    // 1..5
  teamSize: number
  failsRequired: number          // 1, or 2 for quest 4 at 7+ players
  team?: Seat[]
  result?: 'success' | 'fail'
  failCount?: number
}

export type Visibility = 'public' | { only: Seat[] }

export type EventType =
  | 'gameCreated' | 'roleDealt' | 'knowledge'
  | 'utterance' | 'proposal' | 'voteCast' | 'voteReveal'
  | 'questCard' | 'questResult' | 'assassination' | 'gameOver'

export interface GameEvent {
  seq: number
  type: EventType
  payload: Record<string, unknown>
  visibility: Visibility
}

export interface Game {
  id: string
  seed: string
  config: GameConfig
  phase: Phase
  round: number          // 1..5, current quest
  proposalNum: number    // 1..5 within the round
  leaderSeat: Seat
  players: Player[]
  quests: Quest[]
  discussion?: { slot: 'pre' | 'post'; remaining: Seat[] }
  currentTeam?: Seat[]
  pendingVotes: Record<Seat, 'approve' | 'reject'>
  pendingCards: Record<Seat, 'success' | 'fail'>
  winner?: Alignment
  winReason?: string
  log: GameEvent[]
}

// ---- Decisions (the agent boundary) ----

export type DecisionKind = 'discuss' | 'propose' | 'vote' | 'quest' | 'assassinate'

export interface DecisionRequest {
  kind: DecisionKind
  seat: Seat
  round: number
  proposalNum: number
}

export type Decision =
  | { kind: 'discuss'; say: string }
  | { kind: 'propose'; team: Seat[] }
  | { kind: 'vote'; vote: 'approve' | 'reject' }
  | { kind: 'quest'; card: 'success' | 'fail' }
  | { kind: 'assassinate'; target: Seat }

// ---- Views (the hidden-information chokepoint) ----

export interface PrivateInfo {
  evilPartners?: Seat[]     // evil (except Oberon): fellow evil, minus Oberon, minus self
  knownEvil?: Seat[]        // Merlin: all evil except Mordred
  merlinCandidates?: Seat[] // Percival: {Merlin, Morgana}, unordered
}

export interface ProposalRecord {
  round: number
  proposalNum: number
  leader: Seat
  team: Seat[]
  votes?: { seat: Seat; vote: 'approve' | 'reject' }[]
  approved?: boolean
}

export interface PublicPlayer {
  seat: Seat
  name: string
}

export interface PlayerView {
  seat: Seat
  name: string
  role: Role
  alignment: Alignment
  privateInfo: PrivateInfo
  playerCount: number
  rolesInPlay: Role[]           // the role multiset is public knowledge
  players: PublicPlayer[]       // no role/alignment for anyone
  phase: Phase
  round: number
  proposalNum: number
  leaderSeat: Seat
  quests: Quest[]               // quest teams/results/failCounts are public
  proposals: ProposalRecord[]
  currentTeam?: Seat[]
  transcript: { seat: Seat; name: string; text: string }[]
  events: GameEvent[]           // only events visible to this seat
  winner?: Alignment
  winReason?: string
}
