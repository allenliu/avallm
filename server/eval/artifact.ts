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

export const ARTIFACT_SCHEMA = 1

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
    if (a.schema !== ARTIFACT_SCHEMA) {
      throw new Error(`${file}:${i + 1}: schema ${String(a.schema)}, expected ${ARTIFACT_SCHEMA}`)
    }
    out.push(a)
  }
  return out
}
