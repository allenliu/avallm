// Paired-seed, role-forced eval runs (docs/design-evaluation.md §2).
//   node server/eval/bench.ts --role merlin --candidate my-merlin --games 10
//
// Each seed is played twice — once with the baseline agent, once with the
// candidate — and NOTHING else differs: same deal, same names, same
// opponents with the same RNG streams. Role-forcing needs no engine change:
// the deal depends only on the seed, so we find which seat drew the target
// role and seat the agent-under-test THERE, rather than forcing the role to
// a seat. Matched pairs compare how the same game unfolds with one agent
// swapped, which is what makes small-N evals meaningful in a game this
// high-variance.
//
// The default table is heuristic (free, deterministic, instant). --table llm
// seats the roster models and spends real money — use once a candidate
// survives the free tier.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createGame } from '../engine/game.ts'
import { DEFAULT_ROLES } from '../engine/rules.ts'
import { createAgent, createAgentFromDef } from '../agents/registry.ts'
import { loadAgentLibrary, resolveModel } from '../agents/defs.ts'
import { ROSTER } from '../llm/roster.ts'
import { runGame } from '../sim/runner.ts'
import { appendArtifact, toArtifact } from './artifact.ts'
import type { GameArtifact } from './artifact.ts'
import type { AgentDef } from '../agents/defs.ts'
import type { AgentSpec, AvalonAgent } from '../agents/types.ts'
import type { Role, Seat, TalkConfig } from '../engine/types.ts'

export interface BenchOpts {
  role: Role
  candidate: AgentDef
  baseline: AgentDef
  games: number
  seedBase: string
  playerCount?: number
  talk?: TalkConfig
  table?: 'heuristic' | 'llm'
  out?: string                       // JSONL path; omit to skip persistence
  onProgress?: (line: string) => void
}

function tableSeat(table: 'heuristic' | 'llm', seat: Seat): { spec: AgentSpec; descriptor: string; name?: string } {
  if (table === 'llm') {
    const entry = ROSTER[seat % ROSTER.length]
    const dup = Math.floor(seat / ROSTER.length)
    return {
      spec: { type: 'llm', model: entry.id },
      descriptor: `llm:${entry.id}`,
      name: dup ? `${entry.displayName} ${dup + 1}` : entry.displayName,
    }
  }
  return { spec: { type: 'heuristic' }, descriptor: 'heuristic' }
}

export async function runBench(opts: BenchOpts): Promise<GameArtifact[]> {
  const playerCount = opts.playerCount ?? 7
  const table = opts.table ?? 'heuristic'
  if (!DEFAULT_ROLES[playerCount].includes(opts.role)) {
    throw new Error(`role ${opts.role} is not in the ${playerCount}-player role set`)
  }
  const artifacts: GameArtifact[] = []

  for (let i = 0; i < opts.games; i++) {
    const seed = `${opts.seedBase}-${i}`
    for (const variant of ['baseline', 'candidate'] as const) {
      const def = variant === 'candidate' ? opts.candidate : opts.baseline
      // Names come from the table only — identical across variants, so paired
      // transcripts stay comparable and no name betrays which run this is.
      const seatInfo = Array.from({ length: playerCount }, (_, s) => tableSeat(table, s))
      const game = createGame({
        seed, playerCount, talk: opts.talk,
        names: table === 'llm' ? seatInfo.map((s) => s.name!) : undefined,
      })
      const roleSeat = game.players.find((p) => p.role === opts.role)!.seat
      const agents = new Map<Seat, AvalonAgent>()
      const descriptors: string[] = []
      for (const p of game.players) {
        const ctx = { seed, seat: p.seat }
        if (p.seat === roleSeat) {
          agents.set(p.seat, createAgentFromDef(def, ctx))
          descriptors.push(`def:${def.id}`)
        } else {
          agents.set(p.seat, createAgent(seatInfo[p.seat].spec, ctx))
          descriptors.push(seatInfo[p.seat].descriptor)
        }
      }
      const result = await runGame({ game, agents })
      // A def only SUGGESTS its model (resolveModel: override > suggestion >
      // default), so pin the model that actually played into the tags — an
      // eval result without the resolved model is not reproducible.
      const resolved = def.engine.type === 'llm' ? resolveModel(def) : def.engine.type
      const artifact = toArtifact(game, {
        agents: descriptors,
        degraded: result.degraded,
        steps: result.steps,
        tags: { bench: opts.role, variant, pairSeed: seed, agentId: def.id, agentModel: resolved },
      })
      if (opts.out) appendArtifact(opts.out, artifact)
      artifacts.push(artifact)
      opts.onProgress?.(
        `${seed} ${variant.padEnd(9)} ${def.id.padEnd(16)} -> ${game.winner} (${game.winReason})`
        + (result.degraded.length ? `  [${result.degraded.length} degraded]` : ''),
      )
    }
  }
  return artifacts
}

// ---- CLI ----

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      role: { type: 'string', default: 'merlin' },
      candidate: { type: 'string' },              // agent id from the library
      baseline: { type: 'string', default: 'autopilot' },
      games: { type: 'string', default: '10' },
      seed: { type: 'string', default: 'bench' },
      players: { type: 'string', default: '7' },
      talk: { type: 'string', default: '1,0' },
      table: { type: 'string', default: 'heuristic' }, // heuristic | llm
      out: { type: 'string' },
      quiet: { type: 'boolean', default: false },
    },
  })
  if (!values.candidate) {
    console.error('--candidate <agent id> is required (see the agent library, e.g. data/agents/)')
    process.exit(1)
  }
  const library = loadAgentLibrary()
  const byId = (id: string): AgentDef => {
    const def = library.find((d) => d.id === id)
    if (!def) {
      throw new Error(`no agent "${id}" in the library (have: ${library.map((d) => d.id).join(', ')})`)
    }
    return def
  }
  const role = values.role as Role
  const table = values.table as 'heuristic' | 'llm'
  const [pre, post] = values.talk!.split(',').map(Number)
  const out = values.out ?? `data/eval/bench-${role}-${values.seed}.jsonl`

  const artifacts = await runBench({
    role,
    candidate: byId(values.candidate),
    baseline: byId(values.baseline!),
    games: Number(values.games),
    seedBase: values.seed!,
    playerCount: Number(values.players),
    talk: { preProposal: pre, postProposal: post },
    table,
    out,
    onProgress: values.quiet ? undefined : (line) => console.log(line),
  })
  console.log(`\n${artifacts.length} games -> ${out}`)
  console.log(`report: node server/eval/report.ts ${out}`)

  const anyLlm = table === 'llm'
    || [values.candidate, values.baseline].some((id) => byId(id!).engine.type === 'llm')
  if (anyLlm) {
    const { getClient } = await import('../llm/client.ts')
    console.log(`LLM spend: $${getClient().getTotalCost().toFixed(4)}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
