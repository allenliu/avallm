// The situation bank (docs/design-evaluation.md §6): judge-flagged incidents
// mined into single-decision regression situations, replayable against any
// agent config for cents instead of full games.
//
//   node server/eval/bank.ts mine <artifacts.jsonl> [...more] [--out data/eval/bank.jsonl]
//   node server/eval/bank.ts replay <bank.jsonl> --candidate <agentId> [--limit n]
//
// mine: every judged incident (except good-play) whose seq is a decision
// event becomes a bank item carrying the EXACT context the deciding agent
// faced — DecisionRequest, PlayerView, private scratchpad — plus what the
// agent originally did and why the judge flagged it.
//
// replay: rebuild the same prompt path the live game would use (buildMessages
// with the candidate's prompt layers) and make ONE call per situation,
// printing candidate output next to the original. Verdicts are printed for
// eyeballing today; the automated pass/fail checker is the next layer.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { buildMessages } from '../agents/prompts.ts'
import { parseDecision } from '../agents/parse.ts'
import { heuristicDecide } from '../agents/heuristic.ts'
import { loadAgentLibrary } from '../agents/defs.ts'
import { rosterById } from '../llm/roster.ts'
import { CALL_PARAMS } from '../llm/call-params.ts'
import { readArtifacts } from './artifact.ts'
import { snapshotAt } from './replay.ts'
import type { DecisionSnapshot } from './replay.ts'
import type { AgentDef } from '../agents/defs.ts'
import type { LlmCallKind } from '../llm/call-params.ts'
import type { Decision, PlayerView } from '../engine/types.ts'

export interface BankItem {
  bankId: string      // `${artifactId}:${seq}` — the dedupe key
  family: string
  description: string // the judge's incident description
  judgeModel: string
  snapshot: DecisionSnapshot
}

export function mineBank(artifactFiles: string[], existing: BankItem[]): { items: BankItem[]; skipped: number } {
  const seen = new Set(existing.map((i) => i.bankId))
  const items: BankItem[] = []
  let skipped = 0
  for (const file of artifactFiles) {
    for (const a of readArtifacts(file)) {
      if (!a.judge) continue
      for (const inc of a.judge.incidents) {
        if (inc.family === 'good-play') continue
        const bankId = `${a.id}:${inc.seq}`
        if (seen.has(bankId)) continue
        let snapshot: DecisionSnapshot
        try {
          snapshot = snapshotAt(a, inc.seq)
        } catch {
          // The judge cited an engine-emitted event (voteReveal, questResult…)
          // rather than the decision that caused it — no seat to re-decide.
          skipped++
          continue
        }
        seen.add(bankId)
        items.push({ bankId, family: inc.family, description: inc.description, judgeModel: a.judge.model, snapshot })
      }
    }
  }
  return { items, skipped }
}

function describeDecision(d: Decision, view: PlayerView): string {
  switch (d.kind) {
    case 'discuss': {
      const lean = d.lean ? ` [leans ${d.lean}]` : ''
      return d.say.trim() ? `"${d.say}"${lean}` : `(passes)${lean}`
    }
    case 'propose': {
      const team = d.team.map((s) => view.players[s]?.name ?? `seat ${s}`).join('/')
      return `proposes [${team}]${d.pitch ? ` — "${d.pitch}"` : ''}`
    }
    case 'vote': return `votes ${d.vote}`
    case 'quest': return `plays ${d.card}`
    case 'assassinate': return `targets ${view.players[d.target]?.name ?? `seat ${d.target}`}`
  }
}

export async function replayItem(item: BankItem, def: AgentDef): Promise<{ decision?: Decision; error?: string }> {
  const { snapshot } = item
  if (def.engine.type === 'heuristic') {
    return { decision: heuristicDecide(snapshot.req, snapshot.view, snapshot.seed) }
  }
  if (def.engine.type !== 'llm') return { error: `cannot replay against engine type ${def.engine.type}` }
  const { getClient } = await import('../llm/client.ts')
  const kind = snapshot.kind as LlmCallKind
  const params = CALL_PARAMS[kind]
  const messages = buildMessages(kind, snapshot.view, snapshot.scratchpad, {
    personality: def.engine.personality,
    roleGuidance: def.engine.roleGuidance,
  })
  const content = await getClient().call(rosterById(def.engine.model).slug, messages, {
    tag: `eval/bank/${def.id}`,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
    response_format: params.json ? { type: 'json_object' } : undefined,
  })
  const parsed = parseDecision(kind, content, snapshot.view)
  if (parsed.parseFailed || !parsed.decision) return { error: parsed.error ?? 'unparseable' }
  return { decision: parsed.decision }
}

// ---- JSONL helpers ----

function readBank(file: string): BankItem[] {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

function appendBank(file: string, items: BankItem[]): void {
  if (!items.length) return
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.appendFileSync(file, items.map((i) => JSON.stringify(i)).join('\n') + '\n')
}

// ---- CLI ----

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'data/eval/bank.jsonl' },
      candidate: { type: 'string' },
      limit: { type: 'string' },
    },
  })
  const [cmd, ...files] = positionals

  if (cmd === 'mine') {
    if (!files.length) {
      console.error('usage: node server/eval/bank.ts mine <artifacts.jsonl> [...more] [--out bank.jsonl]')
      process.exit(1)
    }
    const existing = readBank(values.out!)
    const { items, skipped } = mineBank(files, existing)
    appendBank(values.out!, items)
    for (const i of items) {
      console.log(`+ ${i.bankId.padEnd(30)} [${i.family}] ${i.snapshot.role} ${i.snapshot.kind} — ${i.description.slice(0, 90)}`)
    }
    console.log(`\nmined ${items.length} new situation(s) (${existing.length} already banked, ${skipped} cited non-decision events) -> ${values.out}`)
    return
  }

  if (cmd === 'replay') {
    const [bankFile] = files
    if (!bankFile || !values.candidate) {
      console.error('usage: node server/eval/bank.ts replay <bank.jsonl> --candidate <agentId> [--limit n]')
      process.exit(1)
    }
    const def = loadAgentLibrary().find((d) => d.id === values.candidate)
    if (!def) throw new Error(`no agent "${values.candidate}" in the library`)
    let items = readBank(bankFile)
    if (values.limit) items = items.slice(0, Number(values.limit))
    for (const item of items) {
      const s = item.snapshot
      console.log(`\n== ${item.bankId} [${item.family}] ${s.role} ${s.kind}, Q${s.req.round}.${s.req.proposalNum} ==`)
      console.log(`judge: ${item.description}`)
      console.log(`original:  ${describeDecision(s.original, s.view)}`)
      const r = await replayItem(item, def)
      console.log(`${def.id}: ${r.decision ? ` ${describeDecision(r.decision, s.view)}` : ` FAILED (${r.error})`}`)
    }
    if (def.engine.type === 'llm') {
      const { getClient } = await import('../llm/client.ts')
      console.log(`\nspend: $${getClient().getTotalCost().toFixed(4)}`)
    }
    return
  }

  console.error('usage: node server/eval/bank.ts <mine|replay> ...')
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
