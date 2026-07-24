// Core engine types. The engine is pure: no I/O, no Date.now, no unseeded randomness.

export type Role =
  | 'merlin' | 'percival' | 'servant'
  | 'assassin' | 'morgana' | 'mordred' | 'oberon' | 'minion'

export type Alignment = 'good' | 'evil'

export type Seat = number

export type Phase =
  | 'discussion' | 'proposal' | 'finalize' | 'vote' | 'quest' | 'assassination' | 'gameOver'

export interface TalkConfig {
  // MAX discussion rounds after the initial proposal. Rounds end early on
  // "lean settlement": a full round in which no non-leader lean was newly
  // declared or changed. 0 = no discussion AND no finalize — the proposal
  // goes straight to vote (test/sim scaffolding).
  maxRounds: number
  // MAX discussion rounds after a revised proposal. 0 = a revision goes
  // straight to vote; revising is still allowed, there is just no talk after.
  maxRoundsAfterChange: number
  // Whether the leader takes a lean-free speaking turn at the END of each
  // discussion round ('last'), or is excluded from the rotation ('none') —
  // the leader already speaks via the proposal pitch and the finalize turn.
  leaderInDiscussion: 'none' | 'last'
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
  | 'gameCreated' | 'roleDealt' | 'knowledge' | 'leadChange'
  | 'utterance' | 'proposal' | 'proposalLocked' | 'proposalRevised'
  | 'voteCast' | 'voteReveal'
  | 'questCard' | 'questResult' | 'assassination' | 'gameOver'
  | 'thinking' | 'rename' | 'scratchpad'

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
  discussion?: {
    remaining: Seat[]     // speakers left in the current round
    roundNum: number      // 1-based; restarts at 1 after a revision
    maxRounds: number     // snapshot of the applicable cap
    postRevision: boolean // false = initial segment, true = after proposalRevised
    // Current declared lean per NON-LEADER seat. Lives on the discussion
    // segment (not Game) so a revision resets leans for free.
    leans: Partial<Record<Seat, Lean>>
    leanChangedThisRound: boolean // any declaration this round that was new or different
  }
  currentTeam?: Seat[]
  pendingVotes: Record<Seat, 'approve' | 'reject'>
  pendingCards: Record<Seat, 'success' | 'fail'>
  winner?: Alignment
  winReason?: string
  log: GameEvent[]
}

// ---- Decisions (the agent boundary) ----

export type DecisionKind = 'discuss' | 'propose' | 'finalize' | 'vote' | 'quest' | 'assassinate'

export interface DecisionRequest {
  kind: DecisionKind
  seat: Seat
  round: number
  proposalNum: number
}

// `thinking` is the deciding agent's private in-character reasoning — the
// engine records it as an event visible only to that seat (post-game reveal
// material). `pitch` on propose is public speech attached to the proposal.
export type Lean = 'approve' | 'reject' | 'unsure'

// `notes` is the agent's refreshed private scratchpad, attached to the first
// decision after a reflect; the engine records it seat-private like thinking.
export type Decision =
  | { kind: 'discuss'; say: string; lean?: Lean; thinking?: string; notes?: string }
  | { kind: 'propose'; team: Seat[]; pitch?: string; thinking?: string; notes?: string }
  | { kind: 'finalize'; stick: true; thinking?: string; notes?: string }
  | { kind: 'finalize'; stick: false; team: Seat[]; reason?: string; thinking?: string; notes?: string }
  | { kind: 'vote'; vote: 'approve' | 'reject'; thinking?: string; notes?: string }
  | { kind: 'quest'; card: 'success' | 'fail'; thinking?: string; notes?: string }
  | { kind: 'assassinate'; target: Seat; thinking?: string; notes?: string }

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
  team: Seat[]          // the FINAL team (post-revision if revised)
  pitch?: string
  revisedFrom?: Seat[]  // original team, present iff the leader revised at finalize
  revisedReason?: string
  votes?: { seat: Seat; vote: 'approve' | 'reject' }[]
  approved?: boolean
  auto?: boolean   // 5th ("hammer") proposal: approved automatically, no vote
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
  discussionRound?: number
  discussionPostRevision?: boolean
  transcript: { seat: Seat; name: string; text: string; lean?: Lean }[]
  events: GameEvent[]           // only events visible to this seat
  winner?: Alignment
  winReason?: string
}
