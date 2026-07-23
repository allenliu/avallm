// Game artifacts — the persistence format of the eval pipeline
// (docs/design-evaluation.md §9 step 1). One artifact = one COMPLETED game,
// fully self-contained: the unredacted event log, the role deal, and a
// per-seat agent descriptor. Everything downstream (metrics, judge,
// situation bank, reports) consumes artifacts, never live Game objects —
// so a game is analyzable forever, by tools that didn't exist when it ran.

import fs from 'node:fs'
import path from 'node:path'
import type { DegradedDecision } from '../sim/runner.ts'
import type { Alignment, Game, GameEvent, Role, Seat, TalkConfig } from '../engine/types.ts'

// Bump on any BREAKING artifact-shape change. Additive fields (like `roles`,
// added in v2) don't require a bump for readers that tolerate their absence —
// readArtifacts accepts anything <= current so old corpora stay analyzable
// (the whole premise of the format), and only refuses artifacts from a FUTURE
// schema it cannot understand.
export const ARTIFACT_SCHEMA = 2

export interface ArtifactPlayer {
  seat: Seat
  name: string
  role: Role
  alignment: Alignment
  agent: string // descriptor: 'heuristic' | 'random' | 'llm:<roster id>' | 'def:<agent id>' | 'stdio' | 'human'
}

export interface GameArtifact {
  schema: number
  id: string
  seed: string
  createdAt: string // ISO — stamped by the I/O layer; the engine stays clock-free
  playerCount: number
  // The roles array IN CONFIG ORDER (pre-shuffle). The gameCreated event only
  // carries rolesInPlay SORTED, which loses the deal, so replay could otherwise
  // only reconstruct default-role games. Persisting this makes every artifact —
  // including custom-role tables creatable via the live server — replayable.
  roles: Role[]
  talk: TalkConfig
  players: ArtifactPlayer[]
  winner: Alignment
  winReason: string
  steps: number
  degraded: DegradedDecision[]
  log: GameEvent[]
  // Free-form labels attached by the producer. The bench runner sets
  // { bench: <role>, variant: 'candidate'|'baseline', pairSeed, agentId } —
  // the report CLI groups paired runs by these.
  tags?: Record<string, string>
  // Post-hoc LLM analyses, written back into the artifact by their CLIs
  // (probe.ts, judge.ts) so a game accumulates its analyses in one record.
  probes?: { virtualAssassin?: VirtualAssassinResult }
  judge?: JudgeResult
}

// ---- post-hoc analysis results ----

export interface VirtualAssassinResult {
  model: string       // roster id used
  samples: number
  picks: (number | null)[] // per-sample seat picked (null = unparseable)
  merlinSeat: number
  hits: number
  hitRate: number
  ranAt: string
}

export interface JudgeScorecard {
  seat: number
  concealment: number | null // 0-10; null where the axis doesn't apply
  deduction: number | null
  influence: number | null
  tableTalk: number | null
  note: string
}

export interface JudgeIncident {
  seat: number
  seq: number
  family: string      // knowledge-leak | commitment-failure | hammer-blindness |
                      // fail-coordination | vote-speech-incoherence | blunder | good-play | other
  description: string
}

export interface JudgeResult {
  model: string
  blinded: {
    evil: number[]           // seats predicted evil from the public record alone
    merlin: number | null    // seat predicted as Merlin
    confidence: number
    evilCorrect: number      // |predicted ∩ actual evil|
    merlinCorrect: boolean
  }
  scorecards: JudgeScorecard[]
  incidents: JudgeIncident[]
  ranAt: string
}

export interface ToArtifactOpts {
  agents: string[] // per-seat descriptors, index = seat
  degraded: DegradedDecision[]
  steps: number
  tags?: Record<string, string>
}

export function toArtifact(game: Game, opts: ToArtifactOpts): GameArtifact {
  if (game.phase !== 'gameOver' || !game.winner || !game.winReason) {
    throw new Error(`artifact requires a finished game (phase: ${game.phase})`)
  }
  if (opts.agents.length !== game.config.playerCount) {
    throw new Error(`agents length ${opts.agents.length} !== playerCount ${game.config.playerCount}`)
  }
  return {
    schema: ARTIFACT_SCHEMA,
    id: game.id,
    seed: game.seed,
    createdAt: new Date().toISOString(),
    playerCount: game.config.playerCount,
    roles: game.config.roles.slice(),
    talk: game.config.talk,
    players: game.players.map((p) => ({
      seat: p.seat, name: p.name, role: p.role, alignment: p.alignment,
      agent: opts.agents[p.seat],
    })),
    winner: game.winner,
    winReason: game.winReason,
    steps: opts.steps,
    degraded: opts.degraded,
    log: game.log,
    ...(opts.tags ? { tags: opts.tags } : {}),
  }
}

// ---- JSONL storage (append-only; one game per line) ----

export function appendArtifact(file: string, artifact: GameArtifact): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(artifact) + '\n')
}

// Rewrite a JSONL file in place — used by the probe/judge CLIs to fold their
// results back into the artifacts they analyzed. Atomic (temp + rename, as
// master's saveCustomDef does): this file holds the WHOLE corpus plus every
// paid probe/judge result, so a crash/redeploy mid-write must not truncate it
// into an unparseable line that fails the entire readArtifacts.
export function writeArtifacts(file: string, artifacts: GameArtifact[]): void {
  const resolved = path.resolve(file)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const tmp = `${resolved}.tmp-${process.pid}`
  fs.writeFileSync(tmp, artifacts.map((a) => JSON.stringify(a)).join('\n') + '\n')
  fs.renameSync(tmp, resolved)
}

export function readArtifacts(file: string): GameArtifact[] {
  const out: GameArtifact[] = []
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error(`${file}:${i + 1}: not valid JSON`)
    }
    const a = parsed as GameArtifact
    // Accept current and older schemas (fields are additive; consumers tolerate
    // a missing `roles` etc.). Only a newer-than-known schema is unreadable.
    if (typeof a.schema !== 'number' || a.schema > ARTIFACT_SCHEMA) {
      throw new Error(`${file}:${i + 1}: schema ${String(a.schema)} is newer than this tool understands (max ${ARTIFACT_SCHEMA})`)
    }
    out.push(a)
  }
  return out
}
