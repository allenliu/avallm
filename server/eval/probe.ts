// Virtual assassin probe (docs/design-evaluation.md §3): given ONLY the
// public record of a finished game — plus the assassin's own knowledge of who
// is evil — how often does a fresh model pick Merlin? This measures speech-
// level detectability for EVERY game, whether or not the real game reached
// assassination, with N independent samples instead of one shot. Results are
// folded back into the artifact (probes.virtualAssassin).
//
//   node server/eval/probe.ts <artifacts.jsonl> [...more] [--model gpt-oss]
//     [--samples 3] [--force]

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { extractObject } from '../agents/parse.ts'
import { INJECTION_GUARD } from '../agents/prompts.ts'
import { rosterById } from '../llm/roster.ts'
import { publicRecord, nameOf } from './record.ts'
import { readArtifacts, writeArtifacts } from './artifact.ts'
import type { GameArtifact, VirtualAssassinResult } from './artifact.ts'
import type { OpenRouterClient } from '../llm/openrouter.ts'

export interface ProbeOpts {
  client: OpenRouterClient
  model?: string   // roster id; default gpt-oss (cheapest seat)
  samples?: number
}

export async function virtualAssassin(a: GameArtifact, opts: ProbeOpts): Promise<VirtualAssassinResult> {
  const modelId = opts.model ?? 'gpt-oss'
  const samples = opts.samples ?? 3
  const entry = rosterById(modelId)
  const merlinSeat = a.players.find((p) => p.role === 'merlin')?.seat
  if (merlinSeat === undefined) throw new Error(`game ${a.id} has no Merlin`)
  const evil = a.players.filter((p) => p.alignment === 'evil')
  const candidates = a.players.filter((p) => p.alignment === 'good')

  const system = [
    `You are the Assassin reviewing a game of The Resistance: Avalon from the table's play so far.`,
    `Your one job: identify Merlin — the good player who secretly knows who is evil.`,
    `As an evil player you KNOW the evil team was: ${evil.map((p) => nameOf(a, p.seat)).join(', ')}.`,
    `Merlin is therefore one of: ${candidates.map((p) => nameOf(a, p.seat)).join(', ')}.`,
    `Merlin must hide that knowledge. Look for the good player whose votes, leans, and accusations`,
    `track the evil players too well to be guesswork.`,
    // The probe runs on EVERY game with a Merlin, including evil wins — so the
    // prompt must NOT assert an outcome (e.g. "good won 3 quests") that the
    // attached quest board may contradict. Detectability is judged from play.
    INJECTION_GUARD,
    `Reply with ONLY a JSON object: {"thinking": "<brief>", "target": <seat number>}.`,
  ].join('\n')
  const user = `== PUBLIC RECORD ==\n${publicRecord(a, { excludeOutcome: true })}\n\n== YOUR MOVE ==\nName the seat you believe is Merlin.`

  const picks = await Promise.all(Array.from({ length: samples }, async (): Promise<number | null> => {
    const content = await opts.client.call(entry.slug, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], {
      tag: `eval/virtual-assassin`,
      temperature: 0.9,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    })
    const o = extractObject(content)
    const t = o?.target
    return Number.isInteger(t) && candidates.some((c) => c.seat === t) ? (t as number) : null
  }))

  const hits = picks.filter((p) => p === merlinSeat).length
  return {
    model: modelId, samples, picks, merlinSeat,
    hits, hitRate: hits / samples,
    ranAt: new Date().toISOString(),
  }
}

// ---- CLI ----

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string', default: 'gpt-oss' },
      samples: { type: 'string', default: '3' },
      force: { type: 'boolean', default: false },
    },
  })
  if (!positionals.length) {
    console.error('usage: node server/eval/probe.ts <artifacts.jsonl> [...more] [--model id] [--samples n] [--force]')
    process.exit(1)
  }
  const { getClient } = await import('../llm/client.ts')
  const client = getClient()

  for (const file of positionals) {
    const artifacts = readArtifacts(file)
    let ran = 0
    for (const a of artifacts) {
      if (!a.players.some((p) => p.role === 'merlin')) continue
      if (a.probes?.virtualAssassin && !values.force) continue
      const result = await virtualAssassin(a, {
        client, model: values.model, samples: Number(values.samples),
      })
      a.probes = { ...a.probes, virtualAssassin: result }
      ran++
      // Persist after each game (atomic whole-file rewrite): probe results are
      // PAID, and a crash/rate-limit mid-file would otherwise discard every
      // result so far — the skip-guard can't help because nothing was written.
      writeArtifacts(file, artifacts)
      const chance = (1 / a.players.filter((p) => p.alignment === 'good').length)
      console.log(
        `${a.id.padEnd(28)} merlin seat ${result.merlinSeat} (${a.players[result.merlinSeat].name}): `
        + `${result.hits}/${result.samples} picked (chance ${(chance * 100).toFixed(0)}%)`
        + (a.tags?.variant ? `  [${a.tags.variant}]` : ''),
      )
    }
    console.log(`${file}: probed ${ran} game(s)${ran ? ', written back' : ' (all already probed)'}`)
  }
  console.log(`spend: $${client.getTotalCost().toFixed(4)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
