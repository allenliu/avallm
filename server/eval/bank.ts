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
// printing candidate output next to the original. With --check, a cheap
// checker call judges whether the replayed decision still exhibits the
// flagged flaw — the automated gate 1 of the promotion loop (design doc §8).

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { buildMessages, sanitizeSpeech, INJECTION_GUARD } from '../agents/prompts.ts'
import type { Msg } from '../llm/openrouter.ts'
import { extractObject, legalityError, parseDecision } from '../agents/parse.ts'
import { heuristicDecide } from '../agents/heuristic.ts'
import { loadAgentLibrary, promptOverridesOf, resolveModel } from '../agents/defs.ts'
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

export interface MineResult {
  items: BankItem[]
  skipped: number             // judge cited an engine-emitted (non-decision) event — expected
  failures: { bankId: string; error: string }[] // replay drift / unsupported deal — NOT expected
}

export function mineBank(artifactFiles: string[], existing: BankItem[]): MineResult {
  const seen = new Set(existing.map((i) => i.bankId))
  const items: BankItem[] = []
  const failures: { bankId: string; error: string }[] = []
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // Distinguish the EXPECTED case (judge cited an engine consequence
          // like voteReveal/questResult — no decider) from real failures
          // (replay drift, unsupported deal). Lumping them hides an unreplayable
          // archive behind a benign-looking "cited non-decision events" count.
          if (msg.includes('is not a decision event')) skipped++
          else failures.push({ bankId, error: msg })
          continue
        }
        seen.add(bankId)
        items.push({ bankId, family: inc.family, description: inc.description, judgeModel: a.judge.model, snapshot })
      }
    }
  }
  return { items, skipped, failures }
}

function describeDecision(d: Decision, view: PlayerView): string {
  switch (d.kind) {
    case 'discuss': {
      const lean = d.lean ? ` [leans ${d.lean}]` : ''
      // sanitize-at-boundary: this text is fed to the checker LLM (checkReplay).
      const say = sanitizeSpeech(d.say)
      return say ? `"${say}"${lean}` : `(passes)${lean}`
    }
    case 'propose': {
      const team = d.team.map((s) => view.players[s]?.name ?? `seat ${s}`).join('/')
      return `proposes [${team}]${d.pitch ? ` — "${sanitizeSpeech(d.pitch)}"` : ''}`
    }
    case 'finalize': {
      if (d.stick) return `sticks with the proposed team`
      const team = d.team.map((s) => view.players[s]?.name ?? `seat ${s}`).join('/')
      return `revises the team to [${team}]${d.reason ? ` — "${sanitizeSpeech(d.reason)}"` : ''}`
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
  const client = getClient()
  const kind = snapshot.kind as LlmCallKind
  const params = CALL_PARAMS[kind]
  const slug = rosterById(resolveModel(def)).slug
  // Reuse the ONE engine→overrides mapping (promptOverridesOf) so a replay
  // renders the same prompt the live agent (createAgentFromDef) would.
  const overrides = promptOverridesOf(def.engine)
  const call = (messages: Msg[]) => client.call(slug, messages, {
    tag: `eval/bank/${def.id}`,
    temperature: def.engine.temperature ?? params.temperature,
    max_tokens: params.max_tokens,
    response_format: params.json ? { type: 'json_object' } : undefined,
  })

  // Match createLlmAgent's decision ladder (llm.ts): tolerant parse + legality
  // check, then ONE correction retry. Without this the replay fails on a first
  // malformed reply the live agent would have recovered from, inflating the
  // candidate's measured failure rate above what it plays at.
  const messages = buildMessages(kind, snapshot.view, snapshot.scratchpad, overrides)
  const first = await call(messages)
  let parsed = parseDecision(kind, first, snapshot.view)
  let error = parsed.parseFailed ? parsed.error! : parsed.decision && legalityError(parsed.decision, snapshot.view)
  if (error) {
    const second = await call([
      ...messages,
      { role: 'assistant', content: first },
      { role: 'user', content: `Your reply was not usable: ${error}. Answer again with ONLY the required JSON object.` },
    ])
    parsed = parseDecision(kind, second, snapshot.view)
    error = parsed.parseFailed ? parsed.error! : parsed.decision && legalityError(parsed.decision, snapshot.view)
    if (error) return { error }
  }
  return { decision: parsed.decision! }
}

// The checker sees only what an outside reviewer needs: the complaint, the
// original action, and the replayed action. It never learns which prompt
// version produced which, beyond the labels here — and "fixed" requires the
// flaw to be gone, not merely different.
export async function checkReplay(
  item: BankItem, replayed: Decision, model = 'gemini',
): Promise<{ verdict: 'fixed' | 'same-flaw' | 'unclear'; note: string }> {
  const { getClient } = await import('../llm/client.ts')
  const s = item.snapshot
  const system = [
    `You are reviewing a single decision from The Resistance: Avalon for a specific flaw.`,
    `A player's original decision was flagged by a game judge. A revised bot faced the IDENTICAL`,
    `situation. Decide whether the revised decision exhibits the SAME flaw. A merely different`,
    `decision is not automatically fixed; judge against the flagged flaw only.`,
    // The decisions quoted below are player/agent speech — treat as data.
    INJECTION_GUARD,
    `Reply with ONLY a JSON object: {"verdict": "fixed"|"same-flaw"|"unclear", "note": "<one line>"}.`,
  ].join('\n')
  const user = [
    `Situation: ${s.role.toUpperCase()} making a "${s.kind}" decision (quest ${s.req.round}, proposal ${s.req.proposalNum}).`,
    `Judge's complaint about the original: ${item.description}`,
    `Original decision:  ${describeDecision(s.original, s.view)}`,
    `Revised decision:   ${describeDecision(replayed, s.view)}`,
  ].join('\n')
  const content = await getClient().call(rosterById(model).slug, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { tag: 'eval/bank-check', temperature: 0, max_tokens: 200, response_format: { type: 'json_object' } })
  const o = extractObject(content)
  const verdict = o?.verdict === 'fixed' || o?.verdict === 'same-flaw' ? o.verdict : 'unclear'
  return { verdict, note: String(o?.note ?? '').slice(0, 200) }
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
      check: { type: 'boolean', default: false },
      checkModel: { type: 'string', default: 'gemini' },
    },
  })
  const [cmd, ...files] = positionals

  if (cmd === 'mine') {
    if (!files.length) {
      console.error('usage: node server/eval/bank.ts mine <artifacts.jsonl> [...more] [--out bank.jsonl]')
      process.exit(1)
    }
    const existing = readBank(values.out!)
    const { items, skipped, failures } = mineBank(files, existing)
    appendBank(values.out!, items)
    for (const i of items) {
      console.log(`+ ${i.bankId.padEnd(30)} [${i.family}] ${i.snapshot.role} ${i.snapshot.kind} — ${i.description.slice(0, 90)}`)
    }
    console.log(`\nmined ${items.length} new situation(s) (${existing.length} already banked, ${skipped} cited non-decision events) -> ${values.out}`)
    if (failures.length) {
      console.error(`\n${failures.length} incident(s) FAILED to replay — the archive may be unreplayable (drift or unsupported deal):`)
      for (const f of failures) console.error(`  ${f.bankId}: ${f.error}`)
    }
    return
  }

  if (cmd === 'replay') {
    const [bankFile] = files
    if (!bankFile || !values.candidate) {
      console.error('usage: node server/eval/bank.ts replay <bank.jsonl> --candidate <agentId> [--limit n]')
      process.exit(1)
    }
    const def = loadAgentLibrary().agents.find((d) => d.id === values.candidate)
    if (!def) throw new Error(`no agent "${values.candidate}" in the library`)
    let items = readBank(bankFile)
    if (values.limit) items = items.slice(0, Number(values.limit))
    const verdicts = { fixed: 0, 'same-flaw': 0, unclear: 0, failed: 0 }
    for (const item of items) {
      const s = item.snapshot
      console.log(`\n== ${item.bankId} [${item.family}] ${s.role} ${s.kind}, Q${s.req.round}.${s.req.proposalNum} ==`)
      console.log(`judge: ${item.description}`)
      console.log(`original:  ${describeDecision(s.original, s.view)}`)
      const r = await replayItem(item, def)
      console.log(`${def.id}: ${r.decision ? ` ${describeDecision(r.decision, s.view)}` : ` FAILED (${r.error})`}`)
      if (!r.decision) { verdicts.failed++; continue }
      if (values.check) {
        const c = await checkReplay(item, r.decision, values.checkModel)
        verdicts[c.verdict]++
        console.log(`check: ${c.verdict.toUpperCase()} — ${c.note}`)
      }
    }
    if (values.check) {
      console.log(`\n${items.length} situations: ${verdicts.fixed} fixed, ${verdicts['same-flaw']} same flaw, `
        + `${verdicts.unclear} unclear${verdicts.failed ? `, ${verdicts.failed} failed to answer` : ''}`)
    }
    if (values.check || def.engine.type === 'llm') {
      const { getClient } = await import('../llm/client.ts')
      console.log(`spend: $${getClient().getTotalCost().toFixed(4)}`)
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
