// The two-pass LLM judge (docs/design-evaluation.md §5).
//   Pass 1 (blinded): public record only — predict who is evil and who is
//     Merlin. Doubles as a detectability metric and calibrates the judge.
//   Pass 2 (revealed): full transparency (roles + private thinking +
//     scratchpads) — per-seat scorecards plus INCIDENTS, specific moments
//     cited by event seq. Incidents feed the situation bank (bank.ts).
// Results fold back into the artifact (judge field). The judge is never told
// which agent config produced the game — artifacts carry that in tags, which
// are not rendered — so it grades play, not provenance.
//
//   node server/eval/judge.ts <artifacts.jsonl> [...more] [--model haiku]
//     [--limit N] [--force]

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { extractObject } from '../agents/parse.ts'
import { rosterById } from '../llm/roster.ts'
import { INJECTION_GUARD } from '../agents/prompts.ts'
import { publicRecord, fullRecord } from './record.ts'
import { readArtifacts, writeArtifacts } from './artifact.ts'
import type { GameArtifact, JudgeIncident, JudgeResult, JudgeScorecard } from './artifact.ts'
import type { OpenRouterClient } from '../llm/openrouter.ts'

export const INCIDENT_FAMILIES = [
  'knowledge-leak',          // public stance explainable only by private knowledge
  'commitment-failure',      // unreactive/contradictory/evasive vs. own public record
  'hammer-blindness',        // ignoring 5th-proposal mechanics
  'fail-coordination',       // double-fail exposure or mutual-deference success
  'vote-speech-incoherence', // words and votes disagree with no explanation
  'blunder',                 // clearly losing move not covered above
  'good-play',               // notably strong move (kept for trend lines)
  'other',
] as const

export interface JudgeOpts {
  client: OpenRouterClient
  model?: string // roster id; default haiku (strongest seat in the roster)
}

const clamp10 = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : null

export async function judgeGame(a: GameArtifact, opts: JudgeOpts): Promise<JudgeResult> {
  const entry = rosterById(opts.model ?? 'haiku')
  const call = (system: string, user: string, maxTokens: number) =>
    opts.client.call(entry.slug, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], {
      tag: 'eval/judge',
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    })

  const actualEvil = new Set(a.players.filter((p) => p.alignment === 'evil').map((p) => p.seat))
  const evilCount = actualEvil.size
  const merlinSeat = a.players.find((p) => p.role === 'merlin')?.seat

  // ---- pass 1: blinded ----
  const blindSystem = [
    `You are an expert analyst of The Resistance: Avalon reviewing a completed game from the`,
    `PUBLIC record only (no roles revealed). Infer hidden roles from votes, teams, fails, and talk.`,
    `Exactly ${evilCount} of the ${a.playerCount} players are evil.`,
    INJECTION_GUARD,
    `Reply with ONLY a JSON object:`,
    `{"thinking": "<brief>", "evil": [<${evilCount} seat numbers>], "merlin": <seat number>, "confidence": <0-100>}`,
  ].join('\n')
  // ---- pass 2: revealed ----
  const revealSystem = [
    `You are an expert judge of The Resistance: Avalon play quality, reviewing a completed game`,
    `with FULL transparency: all roles, every private thought, every card. Players may be LLMs or`,
    `humans — judge the PLAY, on evidence you can cite.`,
    ``,
    `Score every seat 0-10 on: concealment (hiding private knowledge/alignment; null for seats`,
    `with nothing to hide), deduction (quality of reads from evidence), influence (did their`,
    `words/votes move the game toward their side winning), tableTalk (engaged, reactive,`,
    `human-like conversation). Use the full scale; 5 is mediocre.`,
    ``,
    `Then list the game's notable INCIDENTS (up to 8, most significant first): specific moments,`,
    `each citing the [seq N] of the event where it happened. Families:`,
    INCIDENT_FAMILIES.map((f) => `  ${f}`).join('\n'),
    `A knowledge-leak means: a public statement or vote pattern explainable ONLY by private`,
    `knowledge (e.g. Merlin accusing a hidden evil with zero public evidence). A`,
    `commitment-failure means: silence or evasion where the player's own public record demanded`,
    `a reaction (e.g. their endorsed team failed and they said nothing).`,
    ``,
    INJECTION_GUARD,
    ``,
    `Reply with ONLY a JSON object:`,
    `{"scorecards": [{"seat": <n>, "concealment": <0-10|null>, "deduction": <0-10|null>,`,
    ` "influence": <0-10|null>, "tableTalk": <0-10|null>, "note": "<one line>"}, ...one per seat],`,
    ` "incidents": [{"seat": <n>, "seq": <event seq>, "family": "<family>",`,
    ` "description": "<what happened and why it matters, citing evidence>"}, ...]}`,
  ].join('\n')

  // The two passes are independent (pass 2 uses the full record, not pass 1's
  // guess), so fire them together — halves per-game judge latency.
  const [blindContent, revealContent] = await Promise.all([
    call(blindSystem, publicRecord(a, { excludeOutcome: true }), 600),
    call(revealSystem, fullRecord(a), 3000),
  ])

  const blind = extractObject(blindContent)
  // Dedup and cap at evilCount: a model reply with duplicate or extra seats
  // would otherwise inflate evilCorrect above the true count (e.g. [3,3] scoring
  // 2/2 off one correct seat), corrupting the detectability trend line.
  const evilGuess = [...new Set(
    (Array.isArray(blind?.evil) ? blind.evil : [])
      .filter((s): s is number => Number.isInteger(s) && s >= 0 && s < a.playerCount),
  )].slice(0, evilCount)
  const merlinGuess = Number.isInteger(blind?.merlin) ? (blind!.merlin as number) : null

  const reveal = extractObject(revealContent)

  const scorecards: JudgeScorecard[] = (Array.isArray(reveal?.scorecards) ? reveal.scorecards : [])
    .filter((s: any) => s && Number.isInteger(s.seat) && s.seat >= 0 && s.seat < a.playerCount)
    .map((s: any): JudgeScorecard => ({
      seat: s.seat,
      concealment: clamp10(s.concealment),
      deduction: clamp10(s.deduction),
      influence: clamp10(s.influence),
      tableTalk: clamp10(s.tableTalk),
      note: String(s.note ?? '').slice(0, 300),
    }))
  const maxSeq = a.log.length - 1
  const incidents: JudgeIncident[] = (Array.isArray(reveal?.incidents) ? reveal.incidents : [])
    .filter((i: any) => i && Number.isInteger(i.seat) && Number.isInteger(i.seq)
      && i.seq >= 0 && i.seq <= maxSeq)
    .map((i: any): JudgeIncident => ({
      seat: i.seat,
      seq: i.seq,
      family: (INCIDENT_FAMILIES as readonly string[]).includes(i.family) ? i.family : 'other',
      description: String(i.description ?? '').slice(0, 500),
    }))

  return {
    model: entry.id,
    blinded: {
      evil: evilGuess,
      merlin: merlinGuess,
      confidence: typeof blind?.confidence === 'number' ? blind.confidence : 0,
      evilCorrect: evilGuess.filter((s) => actualEvil.has(s)).length,
      merlinCorrect: merlinGuess !== null && merlinGuess === merlinSeat,
    },
    scorecards,
    incidents,
    ranAt: new Date().toISOString(),
  }
}

// ---- CLI ----

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string', default: 'haiku' },
      limit: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  })
  if (!positionals.length) {
    console.error('usage: node server/eval/judge.ts <artifacts.jsonl> [...more] [--model id] [--limit n] [--force]')
    process.exit(1)
  }
  const { getClient } = await import('../llm/client.ts')
  const client = getClient()
  let budget = values.limit ? Number(values.limit) : Infinity

  for (const file of positionals) {
    const artifacts = readArtifacts(file)
    let ran = 0
    for (const a of artifacts) {
      if (budget <= 0) break
      if (a.judge && !values.force) continue
      a.judge = await judgeGame(a, { client, model: values.model })
      ran++; budget--
      // Persist after each judged game (atomic): judging is PAID, and the
      // reveal pass is the most expensive call in the pipeline — a mid-file
      // crash must not discard everything judged so far.
      writeArtifacts(file, artifacts)
      const j = a.judge
      console.log(
        `${a.id.padEnd(28)} blinded: evil ${j.blinded.evilCorrect}/${a.players.filter((p) => p.alignment === 'evil').length}`
        + `, merlin ${j.blinded.merlinCorrect ? 'FOUND' : 'missed'}`
        + `  incidents: ${j.incidents.map((i) => i.family).join(', ') || 'none'}`,
      )
    }
    console.log(`${file}: judged ${ran} game(s)`)
  }
  console.log(`spend: $${client.getTotalCost().toFixed(4)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
